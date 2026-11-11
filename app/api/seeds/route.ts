import { isSeedsSymbol, seedsMint } from "../../../src/domain/seeds-split";
import { adminWallets } from "../../../src/server/admin-wallets";
import { createHash } from "node:crypto";
import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { seedMessage, type SeedRequest } from "../../../lib/seed-message";
import { address, solToLamports } from "../../../src/shared/domain";
import { ed25519VoteVerifier } from "../../../src/integrations/ed25519";
import { getLaunchProvider, getLaunchService, getStore } from "../../../src/server/runtime";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { notifyLaunchWorker } from "../../../src/server/launch-wake";
import { publicRouteError } from "../../../src/server/route-errors";
import { parseLaunchSettings } from "../../../src/domain/launch-settings";
import { dailyLoss, dailyLossLimit, maxBundleLamports, seedBuys, seedLimit, TREASURY_WALLET, treasuryBusy } from "../../../src/server/treasury";

const limiter = new IngressRateLimiter("seed-launch", 5, 10 * 60_000);
const MAX_AGE_MS = 5 * 60_000;
/** The bundle sells once the coin exists; this leaves time to prepare it. */
const LAUNCH_DELAY_MS = 130_000;
const text = (value: unknown) => (typeof value === "string" ? value : "");
/** When each bundle wallet sells, in seconds after the buy is final. */
const SELL_AFTER_SECONDS = [0, 3, 5, 10];

/** A free launch: a SeedRequest plus its `signature` (base58) over seedMessage,
 * which covers every field. The treasury pays for everything and is the coin's
 * dev and fee recipient; four wallets each buy in the launch bundle, then sell
 * one at a time: at once, and 3, 5 and 10 seconds after their buys are final. The same signed request always
 * returns the same launch. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const readiness = await getOperationalLaunchReadiness();
    if (!readiness.enabled) throw new ApiError("Launches are temporarily unavailable.", 503);
    const body = await readBoundedJson<Record<string, unknown>>(request, 16_384);
    const seed: SeedRequest = {
      wallet: address.parse(body.wallet),
      name: text(body.name).trim(),
      symbol: text(body.symbol).trim().replace(/^\$/, ""),
      description: text(body.description),
      image: text(body.image),
      website: text(body.website),
      x: text(body.x),
      telegram: text(body.telegram),
      issuedAt: typeof body.issuedAt === "number" ? body.issuedAt : 0,
      nonce: text(body.nonce),
    };
    const signature = text(body.signature);
    // $SEEDS is LaunchSeeds' own coin: only an admin launches it, and only once.
    if (isSeedsSymbol(seed.symbol) && (!adminWallets().includes(seed.wallet) || seedsMint()))
      throw new ApiError("That ticker is reserved.", 400);
    if (!signature || !/^[a-f0-9]{32}$/.test(seed.nonce) || Math.abs(Date.now() - seed.issuedAt) > MAX_AGE_MS)
      throw new ApiError("Sign a fresh launch request.", 400);
    if (!(await ed25519VoteVerifier.verify({ wallet: seed.wallet, signature, message: seedMessage(seed) })))
      throw new ApiError("Signature does not match.", 403);
    // One signed request is one launch: a resend finds the launch it already made.
    const capability = createHash("sha256").update(signature).digest("hex");

    const store = getStore(), service = await getLaunchService(), now = Date.now();
    const input = { name: seed.name, symbol: seed.symbol, description: seed.description, image: seed.image, website: "", x: seed.x, telegram: seed.telegram, devBuySol: "0" };
    const existing = store.repo.tokens.getByAccess(createHash("sha256").update(capability).digest("hex"));
    if (!existing) {
      const limited = seedLimit(store.repo.tokens.all(), seed.wallet, now, Number(process.env.LAUNCHSEEDS_DAILY_LAUNCHES || 20));
      if (limited) throw new ApiError(limited, 429);
      const lossLimit = dailyLossLimit();
      if (lossLimit > 0n && dailyLoss(store.repo, now) >= lossLimit) throw new ApiError("Launches are paused for today. Try again tomorrow.", 503);
      if (treasuryBusy(store.repo)) throw new ApiError("Another coin is launching. Try again in a few minutes.", 409);
    }

    const provider = await getLaunchProvider();
    if (!provider) throw new ApiError("Launches are temporarily unavailable.", 503);
    const maxBundle = maxBundleLamports();
    if (maxBundle === 0n) throw new ApiError("Launches are temporarily unavailable.", 503);
    const treasury = provider.walletFor(TREASURY_WALLET).address;
    let settings;
    if (existing) settings = JSON.parse(existing.launchSettingsJson ?? "{}");
    else {
      // Coins' unpaid challenge money stays in the treasury.
      const owed = store.repo.challenges.owedInTreasury();
      const buys = seedBuys(BigInt(await provider.balanceLamports(treasury)), BigInt(solToLamports(process.env.LAUNCH_BASE_SOL || "0")), maxBundle, owed);
      if (!buys) throw new ApiError("The treasury is refilling after the last launch. Try again soon.", 503);
      settings = {
        publishMint: true,
        publishProject: true,
        scheduledAt: now + LAUNCH_DELAY_MS,
        // One wallet per column; each sells on its own, spaced out after the buy.
        userBatches: { proceedsWallet: treasury, columns: buys.map((buy, i) => ({ slots: [Number(buy)], exit: { kind: "after", seconds: SELL_AFTER_SECONDS[i]! } })) },
        bundleLamports: Number(buys.reduce((a, b) => a + b, 0n)),
        // The treasury is every coin's dev and fee recipient; each coin's share is tracked.
        feesTo: treasury,
      };
    }
    const status = await service.create(input, capability, undefined, parseLaunchSettings(settings), seed.wallet);
    notifyLaunchWorker();
    const id = status.mint || status.plan?.planHash;
    return apiJson({ coinUrl: id ? `/coin/${encodeURIComponent(id)}` : null, mint: status.mint || null });
  } catch (error) {
    return publicRouteError(error);
  }
}
