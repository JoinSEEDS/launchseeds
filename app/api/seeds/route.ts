import { createHash } from "node:crypto";
import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { seedMessage, type SeedRequest } from "../../../lib/seed-message";
import { address } from "../../../src/shared/domain";
import { ed25519VoteVerifier } from "../../../src/integrations/ed25519";
import { getLaunchProvider, getLaunchService, getStore } from "../../../src/server/runtime";
import { getOperationalLaunchReadiness } from "../../../src/server/launch-health";
import { publicRouteError } from "../../../src/server/route-errors";
import { maxBundleLamports, seedLimit } from "../../../src/server/treasury";
import { isSeedsSymbol } from "../../../src/domain/seeds-split";
import { adminWallets } from "../../../src/server/admin-wallets";
import { advanceQueue, nextSlot, queueKey, queueState } from "../../../src/server/launch-queue";

const limiter = new IngressRateLimiter("seed-launch", 5, 10 * 60_000);
const MAX_AGE_MS = 5 * 60_000;
const text = (value: unknown) => (typeof value === "string" ? value : "");
/** True once a $SEEDS launch is live, under way or waiting in line. */
function seedsTaken() {
  const store = getStore();
  if (process.env.LAUNCHSEEDS_SEEDS_MINT?.trim()) return true;
  const isSeeds = (symbol: string) => isSeedsSymbol(symbol);
  return store.repo.tokens.all().some((t) => isSeeds(t.symbol) && t.status !== "failed")
    || store.repo.launchQueue.waiting().some((w) => isSeeds(String((JSON.parse(w.inputJson) as { symbol?: string }).symbol ?? "")));
}

/** Where a queued launch stands: `?key=` from the POST answer. */
export async function GET(request: Request): Promise<Response> {
  try {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!/^[a-f0-9]{32}$/.test(key)) throw new ApiError("Unknown launch.", 404);
    const state = queueState(getStore(), key);
    if (!state) throw new ApiError("Unknown launch.", 404);
    return apiJson(state, 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}

/** A free launch: a SeedRequest plus its `signature` (base58) over seedMessage,
 * which covers every field. It joins the launch queue; the oldest request
 * launches whenever the treasury is free. The treasury pays for everything and
 * is the coin's dev and fee recipient; four wallets each buy in the launch
 * bundle, then sell at once and 3, 5 and 10 seconds after their buys are final.
 * The same signed request always returns the same place in line or launch. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const readiness = await getOperationalLaunchReadiness();
    if (!readiness.enabled || maxBundleLamports() === 0n) throw new ApiError("Launches are temporarily unavailable.", 503);
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
    if (isSeedsSymbol(seed.symbol) && (!adminWallets().includes(seed.wallet) || seedsTaken()))
      throw new ApiError("That ticker is reserved.", 400);
    if (!signature || !/^[a-f0-9]{32}$/.test(seed.nonce) || Math.abs(Date.now() - seed.issuedAt) > MAX_AGE_MS)
      throw new ApiError("Sign a fresh launch request.", 400);
    if (!(await ed25519VoteVerifier.verify({ wallet: seed.wallet, signature, message: seedMessage(seed) })))
      throw new ApiError("Signature does not match.", 403);
    // One signed request is one launch: a resend finds its place in line or its launch.
    const capability = createHash("sha256").update(signature).digest("hex"), key = queueKey(capability);
    const store = getStore(), now = Date.now();
    if (!store.repo.launchQueue.byCapability(capability)) {
      // Waiting requests count toward the daily limits like launches do.
      const waiting = store.repo.launchQueue.waiting().map((w) => ({ createdAt: w.createdAt, status: "queued", creatorWallet: w.wallet }));
      const limited = seedLimit([...store.repo.tokens.all(), ...waiting] as never, seed.wallet, now, Number(process.env.LAUNCHSEEDS_DAILY_LAUNCHES || 20), Number(process.env.LAUNCHSEEDS_WALLET_DAILY_LAUNCHES || 5));
      if (limited) throw new ApiError(limited, 429);
      const input = { name: seed.name, symbol: seed.symbol, description: seed.description, image: seed.image, website: "", x: seed.x, telegram: seed.telegram, devBuySol: "0" };
      store.repo.launchQueue.add({ key, capability, wallet: seed.wallet, inputJson: JSON.stringify(input), now, scheduledFor: nextSlot(store, now) });
    }
    // Start right away when nothing is ahead and the treasury is free.
    const provider = await getLaunchProvider();
    if (provider) await advanceQueue(store, await getLaunchService(), provider);
    return apiJson(queueState(store, key));
  } catch (error) {
    return publicRouteError(error);
  }
}
