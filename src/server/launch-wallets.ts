import type { LaunchseedsRepo } from "../db/repo";
import type { BundleBuyer } from "./launch-bundle";

/** Fresh launch wallets are reused across launches. A wallet is reusable once
 * a column or tranche it bought in has settled, whose payout verified it left
 * empty, and while no unfinished launch lists it; a launch keeps the wallets
 * its saved plan already assigned. New wallets are made only beyond those. */
const FINISHED_RUN = new Set(["settled", "skipped"]);

/** Wallets an unfinished launch other than `tokenId` may still use. */
export function busyLaunchWallets(repo: LaunchseedsRepo, tokenId: number, now = Date.now()) {
  const busy = new Set<string>();
  const runs = repo.userBatches.everyRun();
  const states = runs.map((row) => ({ row, state: JSON.parse(row.stateJson) as { status: string; buyers: Array<{ wallet: string }> } }));
  for (const { row, state } of states)
    if (row.tokenId !== tokenId && !FINISHED_RUN.has(state.status)) for (const b of state.buyers) busy.add(b.wallet);
  for (const row of repo.userBatches.activeLiquidations())
    if (row.tokenId !== tokenId) for (const w of (JSON.parse(row.stateJson) as { wallets: Array<{ wallet: string }> }).wallets) busy.add(w.wallet);
  for (const plan of repo.scheduledPlans.all()) {
    if (plan.tokenId === tokenId) continue;
    const token = repo.tokens.get(plan.tokenId);
    const tokenRuns = states.filter(({ row }) => row.tokenId === plan.tokenId);
    // Finished: launched with every run done, or never paid and closed / past its quote.
    const unpaid = !!token && token.fundingReceivedLamports === "0" && repo.deposits.sumLamports(token.id) === 0n;
    const finished = !token ||
      (token.status === "live" && tokenRuns.length > 0 && tokenRuns.every(({ state }) => FINISHED_RUN.has(state.status))) ||
      (unpaid && (token.status === "failed" || token.status === "expired" || (token.status === "funding" && (token.quoteExpiresAt ?? 0) < now)));
    if (!finished) for (const b of JSON.parse(plan.buyersJson) as BundleBuyer[]) busy.add(b.wallet);
  }
  return busy;
}

/** Fresh wallets that bought in a settled run, oldest first, by name. */
export function settledFreshWallets(repo: LaunchseedsRepo) {
  const seen = new Map<string, string>();
  for (const row of repo.userBatches.everyRun()) {
    const state = JSON.parse(row.stateJson) as { status: string; buyers: Array<{ name: string; wallet: string; role?: string }> };
    if (state.status !== "settled") continue;
    for (const b of state.buyers) if (b.role === "fresh" && /^launchseeds-bundle-/.test(b.name) && !seen.has(b.wallet)) seen.set(b.wallet, b.name);
  }
  return [...seen].map(([wallet, name]) => ({ wallet, name }));
}

/** Slot key that survives re-planning: `c<column>:<slot>` or `t<tranche>:<slot>`. */
export const slotKey = (b: Pick<BundleBuyer, "batchIndex" | "tranche">, slot: number) =>
  b.tranche !== undefined ? `t${b.tranche}:${slot}` : `c${b.batchIndex ?? 0}:${slot}`;

/** Chooses each fresh slot's wallet: the launch's previous choice, else a
 * reusable wallet, else a new one (named by `fallbackName`). */
export function assignFreshWallets(input: {
  slots: Array<{ key: string; fallbackName: string }>;
  previous: Map<string, { name: string; wallet: string }>;
  reusable: Array<{ name: string; wallet: string }>;
  busy: Set<string>;
  exclude: Set<string>;
}) {
  const taken = new Set<string>();
  const free = (w: { wallet: string }) => !input.busy.has(w.wallet) && !input.exclude.has(w.wallet) && !taken.has(w.wallet);
  const chosen = new Map<string, { name: string; wallet?: string }>();
  // Keep earlier choices first, so re-planning one launch never shuffles it.
  for (const slot of input.slots) {
    const before = input.previous.get(slot.key);
    if (before && free(before)) { chosen.set(slot.key, before); taken.add(before.wallet); }
  }
  const pool = input.reusable.filter(free);
  for (const slot of input.slots) {
    if (chosen.has(slot.key)) continue;
    const next = pool.find((w) => !taken.has(w.wallet));
    if (next) { chosen.set(slot.key, next); taken.add(next.wallet); }
    else chosen.set(slot.key, { name: slot.fallbackName });
  }
  return chosen;
}
