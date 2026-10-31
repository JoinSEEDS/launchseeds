import {
  ApiError,
  apiJson,
  readBoundedJson,
  requireSameOrigin,
} from "../../../../../lib/api-security";
import { IngressRateLimiter } from "../../../../../lib/trusted-client";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getBundleEngine, getStore } from "../../../../../src/server/runtime";
import { finalizeMessage } from "../../../../../lib/bundle-message";
import { ed25519VoteVerifier } from "../../../../../src/integrations/ed25519";
import { address } from "../../../../../src/shared/domain";
import { adminWallets } from "../../../../../src/server/admin-wallets";
import { UserBatchStateSchema } from "../../../../../src/server/user-batch-engine";
import { CoinLiquidationSchema } from "../../../../../src/server/coin-liquidation";
import { parseBundleIntent, type BundleBuyer } from "../../../../../src/server/launch-bundle";
import { storedLaunchSettings } from "../../../../../src/domain/launch-settings";

const limiter = new IngressRateLimiter("admin-finalize", 10, 600_000);
const MAX_AGE_MS = 5 * 60_000;

/** Admin wallet: `{ wallet, issuedAt, signature }` signing finalizeMessage.
 * Every unsettled column of a user-funded launch is marked forced: the worker
 * sells it at market now (whatever its rule), resumes a stuck one from what the
 * chain shows, and pays the launch's published proceeds wallet as usual. A
 * holding LaunchSeeds protection bundle sells at market too and settles as it
 * would. The admin picks no destination. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed)
      throw new ApiError("Too many attempts. Try again later.", 429);
    const admins = adminWallets();
    if (!admins.length) throw new ApiError("Admin finalize is not configured.", 503);
    const store = getStore();
    const uid = (await params).uid;
    const token = store.repo.tokens.getByMint(uid) ?? store.repo.tokens.getByHandle(uid);
    if (!token?.mint) throw new ApiError("Coin not found.", 404);
    const body = await readBoundedJson<Record<string, unknown>>(request, 2048);
    const wallet = address.parse(body.wallet);
    if (typeof body.signature !== "string" || typeof body.issuedAt !== "number" || Math.abs(Date.now() - body.issuedAt) > MAX_AGE_MS)
      throw new ApiError("Sign a fresh request.", 400);
    if (!admins.includes(wallet)) throw new ApiError("Only an admin wallet can finalize.", 403);
    const action = body.action === "liquidate" ? "liquidate" : "finalize";
    if (!(await ed25519VoteVerifier.verify({ wallet, signature: body.signature, message: finalizeMessage(token.mint, wallet, body.issuedAt, action) } as never)))
      throw new ApiError("Signature does not match.", 403);

    const results: string[] = [];
    for (const row of store.repo.userBatches.byToken(token.id)) {
      const state = UserBatchStateSchema.parse(JSON.parse(row.stateJson));
      const column = `Column ${row.batchIndex + 1}`;
      if (state.status === "settled") { results.push(`${column}: already paid out`); continue; }
      if (state.forced) { results.push(`${column}: already finalizing (${state.status})`); continue; }
      // A holding column's prepared sale was never sent (it is sent only after
      // the switch to exiting); drop it so the next one has no profit minimum.
      const next = { ...state, forced: true, ...(state.status === "holding" ? { sale: null } : {}) };
      const saved = store.repo.userBatches.save(row.id, row.revision, JSON.stringify(UserBatchStateSchema.parse(next)), Date.now());
      results.push(`${column}: ${saved ? `finalizing from ${state.status}` : "changed meanwhile; try again"}`);
    }
    const bundle = store.repo.launchBundles.byToken(token.id);
    if (bundle && !bundle.external && bundle.status === "holding") {
      const engine = await getBundleEngine();
      if (!engine) results.push("Protection bundle: sniper protection is not running");
      else results.push(`Protection bundle: ${await engine.closeNow(token.id, undefined, "admin")}`);
    } else if (bundle) results.push(`Protection bundle: ${bundle.external ? "run by the launch CLI" : bundle.status}`);
    if (action === "liquidate") results.push(startLiquidation(store, token, wallet));
    if (!results.length) results.push("Nothing to finalize on this coin.");
    console.log(`Admin finalize ${token.mint} by ${wallet}: ${results.join("; ")}`);
    return apiJson({ results });
  } catch (error) {
    if (error instanceof Error && !(error instanceof ApiError)) console.error("Admin finalize failed", error.message);
    return publicRouteError(error);
  }
}

/** Liquidate everything: every wallet the launch used sells all its tokens of
 * the coin (SOL stays in it); the deployer is also swept to the destination. */
function startLiquidation(store: ReturnType<typeof getStore>, token: { id: number; mint: string | null; intent: string | null; launchSettingsJson: string | null }, by: string) {
  const plan = store.repo.scheduledPlans.byToken(token.id);
  const intent = parseBundleIntent(token.intent);
  const settings = storedLaunchSettings(token.launchSettingsJson);
  const destination = settings.userBatches?.proceedsWallet ?? settings.feesTo ?? null;
  if (!plan || !intent || !destination) return "Liquidate everything: only user-funded column launches are supported";
  const buyers = JSON.parse(plan.buyersJson) as BundleBuyer[];
  const wallets = [
    ...buyers.map((b) => ({ wallet: b.wallet, role: b.role === "signer" ? ("signer" as const) : ("fresh" as const), batchIndex: b.batchIndex ?? 0 })),
    ...(intent.fundingWallet ? [{ wallet: intent.fundingWallet, role: "deployer" as const, batchIndex: null }] : []),
  ];
  const state = CoinLiquidationSchema.parse({ version: 2, mint: token.mint, destination, requestedBy: by, status: "pending", wallets });
  store.repo.userBatches.startLiquidation(token.id, JSON.stringify(state), Date.now());
  return `Liquidate everything: started for ${wallets.length} wallets (the deployer's SOL goes to ${destination.slice(0, 4)}…${destination.slice(-4)})`;
}
