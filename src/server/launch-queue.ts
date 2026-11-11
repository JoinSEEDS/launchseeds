/** Free launches wait their turn. Every accepted, signed request joins a queue;
 * whenever the treasury is free, the oldest one launches, with a bundle sized
 * from what the treasury holds at that moment. Launchers see their place in
 * line and a rough wait. */
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/api-security";
import { parseLaunchSettings, storedLaunchSettings } from "../domain/launch-settings";
import { solToLamports } from "../shared/domain";
import type { Store } from "./store";
import type { LaunchService } from "./launch";
import { dailyLoss, dailyLossLimit, maxBundleLamports, seedBuys, seedsBundleLamports, TREASURY_WALLET, treasuryBusy } from "./treasury";
import { oneLaunchAtATime } from "./launch-gate";
import { isSeedsSymbol } from "../domain/seeds-split";
import { notifyLaunchWorker } from "./launch-wake";

/** The bundle sells once the coin exists; this leaves time to prepare it. */
export const LAUNCH_DELAY_MS = 130_000;
/** When each bundle wallet sells, in seconds after the buy is final. */
export const SELL_AFTER_SECONDS = [0, 3, 5, 10];
/** For up to this long after its time, a bundle wallet only sells while the
 * market cap stays at or above where the bundle left it; then at market. */
export const HOLD_FLOOR_SECONDS = 60;
/** About how long one launch holds the treasury: the delay, the launch, the sells and their payback. */
export const LAUNCH_SLOT_MS = LAUNCH_DELAY_MS + 130_000;

export type QueuedInput = { name: string; symbol: string; description: string; image: string; website: string; x: string; telegram: string; devBuySol: string };
type Provider = { walletFor(name: string): { address: string }; balanceLamports(address: string): Promise<number | bigint> };
export const queueKey = (capability: string) => createHash("sha256").update(`queue:${capability}`).digest("hex").slice(0, 32);

/** When the launch now holding the treasury should let go of it. */
function busyUntil(store: Store, now: number) {
  let until = 0;
  for (const token of store.repo.tokens.byFundingWalletName(TREASURY_WALLET)) {
    if (!["preparing", "funding", "deploying", "live"].includes(token.status)) continue;
    const at = storedLaunchSettings(token.launchSettingsJson).scheduledAt;
    if (at && at + LAUNCH_SLOT_MS - LAUNCH_DELAY_MS > now) until = Math.max(until, at + LAUNCH_SLOT_MS - LAUNCH_DELAY_MS);
  }
  return until;
}

/** Where a request stands: launched (with its coin), failed, or waiting with its place and a rough wait. */
export function queueState(store: Store, key: string, now = Date.now()) {
  const entry = store.repo.launchQueue.byKey(key);
  if (!entry) return null;
  if (entry.status === "started") {
    const token = entry.tokenId ? store.repo.tokens.get(entry.tokenId) : null;
    const plan = token ? store.repo.scheduledPlans.byToken(token.id) : null;
    const id = token?.mint ?? (token?.mintSignerRef?.startsWith("launchseeds-mint-") ? token.mintSignerRef.slice(17) : null) ?? plan?.planHash ?? null;
    return { key, status: "started" as const, coinUrl: id ? `/coin/${encodeURIComponent(id)}` : null };
  }
  if (entry.status === "failed") return { key, status: "failed" as const, error: entry.error ?? "The launch could not start." };
  const waiting = store.repo.launchQueue.waiting();
  const ahead = waiting.filter((w) => w.id < entry.id).length;
  const at = slotOf(entry);
  const busy = treasuryBusy(store.repo) ? Math.max(busyUntil(store, now) - now, 30_000) : 0;
  return { key, status: "waiting" as const, position: ahead + 1, ahead, scheduledFor: at, etaSeconds: Math.round(Math.max(at - now, busy, 0) / 1000), note: entry.error };
}

/** Minutes between two coins' launch times ([launchseeds] queue_gap_minutes). */
export const queueGapMs = (env: Record<string, string | undefined> = process.env) => {
  const minutes = Number(env.LAUNCHSEEDS_QUEUE_GAP_MINUTES ?? 20);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 20) * 60_000;
};
/** A request's launch time; "Launch now" makes it due at once. */
const slotOf = (w: { scheduledFor: number | null; createdAt: number; approvedAt: number | null }) =>
  w.approvedAt !== null ? Math.min(w.approvedAt, w.scheduledFor ?? w.approvedAt) : (w.scheduledFor ?? w.createdAt + queueGapMs()); // a row from before launch times waits a gap
/** The next free launch time: a gap after the latest one given out, or a gap from now. */
export function nextSlot(store: Store, now = Date.now()) {
  return Math.max(now, store.repo.launchQueue.lastSlot() ?? 0) + queueGapMs();
}

/** The public line: every waiting launch in order with its time and description,
 * and the ones started or removed lately. No wallets. */
export function queueList(store: Store, now = Date.now()) {
  const card = (w: { id: number; key: string; inputJson: string; createdAt: number; scheduledFor: number | null; approvedAt: number | null }) => {
    const input = JSON.parse(w.inputJson) as { name?: string; symbol?: string; image?: string; description?: string };
    return { key: w.key, name: input.name ?? "", symbol: input.symbol ?? "", image: input.image ?? "", description: (input.description ?? "").slice(0, 280), createdAt: w.createdAt, scheduledFor: slotOf(w), launchingNow: w.approvedAt !== null };
  };
  const waiting = store.repo.launchQueue.waiting().map((w, i) => ({ ...card(w), position: i + 1 }));
  const recent = store.repo.launchQueue.recent(now - 86_400_000).map((w) => ({ ...card(w), status: w.status, coinUrl: w.status === "started" ? queueState(store, w.key, now)?.coinUrl ?? null : null, error: w.status === "failed" ? w.error : null }));
  return { treasuryBusy: treasuryBusy(store.repo), now, waiting, recent };
}

/** Launches the oldest waiting request if the treasury is free. Safe to call often. */
export function advanceQueue(store: Store, service: LaunchService, provider: Provider, now = () => Date.now()) {
  return oneLaunchAtATime(async () => {
    // The coin whose time has come first; "Launch now" makes a coin due at once.
    const head = store.repo.launchQueue.waiting().filter((w) => slotOf(w) <= now()).sort((a, b) => slotOf(a) - slotOf(b) || a.id - b.id)[0];
    if (!head || treasuryBusy(store.repo)) return null;
    const lossLimit = dailyLossLimit();
    if (lossLimit > 0n && dailyLoss(store.repo, now()) >= lossLimit) { store.repo.launchQueue.note(head.id, "Launches are paused for today; your turn comes after the pause."); return null; }
    // $SEEDS buys and sells like every launch, with its own bundle size.
    const isSeeds = isSeedsSymbol(String((JSON.parse(head.inputJson) as { symbol?: string }).symbol ?? ""));
    const maxBundle = isSeeds && seedsBundleLamports() > 0n ? seedsBundleLamports() : maxBundleLamports();
    if (maxBundle === 0n) return null;
    const treasury = provider.walletFor(TREASURY_WALLET).address;
    // Coins' unpaid challenge money and the $SEEDS pool stay in the treasury.
    const buys = seedBuys(BigInt(await provider.balanceLamports(treasury)), BigInt(solToLamports(process.env.LAUNCH_BASE_SOL || "0")), maxBundle, store.repo.challenges.owedInTreasury());
    if (!buys) { store.repo.launchQueue.note(head.id, "Waiting for the treasury to refill."); return null; }
    const settings = parseLaunchSettings({
      publishMint: true,
      publishProject: true,
      scheduledAt: now() + LAUNCH_DELAY_MS,
      // One wallet per column; each sells on its own, spaced out after the buy.
      userBatches: { proceedsWallet: treasury, columns: buys.map((buy, i) => ({ slots: [Number(buy)], exit: { kind: "after", seconds: SELL_AFTER_SECONDS[i]!, holdFloorSeconds: HOLD_FLOOR_SECONDS } })) },
      bundleLamports: Number(buys.reduce((a, b) => a + b, 0n)),
      // The treasury is every coin's dev and fee recipient; each coin's share is tracked.
      feesTo: treasury,
    });
    try {
      let tokenId = 0;
      await service.create(JSON.parse(head.inputJson) as QueuedInput, head.capability, (id) => { tokenId = id; }, settings, head.wallet);
      store.repo.launchQueue.finish(head.id, { status: "started", tokenId, error: null, startedAt: now() });
      notifyLaunchWorker();
      return tokenId;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return null; // the treasury got busy; try again later
      const message = error instanceof ApiError ? error.message : "The launch could not start.";
      store.repo.launchQueue.finish(head.id, { status: "failed", error: message, startedAt: now() });
      if (!(error instanceof ApiError)) console.error("queued launch failed", error);
      return null;
    }
  });
}

/** Keeps the queue moving in the web process. */
export function startLaunchQueue(deps: () => Promise<{ store: Store; service: LaunchService; provider: Provider | null }>, everyMs = 5_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { store, service, provider } = await deps();
      if (provider && store.repo.launchQueue.waiting().length) await advanceQueue(store, service, provider);
    } catch (error) {
      console.error("launch queue", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
