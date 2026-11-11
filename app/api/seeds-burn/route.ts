import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { publicRouteError } from "../../../src/server/route-errors";
import { getLaunchProvider, getStore } from "../../../src/server/runtime";
import { ed25519VoteVerifier } from "../../../src/integrations/ed25519";
import { address } from "../../../src/shared/domain";
import { requestSeedsBurn, seedsView } from "../../../src/server/seeds-view";
import { adminWallets } from "../../../src/server/admin-wallets";
import { TREASURY_WALLET } from "../../../src/server/treasury";

const limiter = new IngressRateLimiter("seeds-burn", 10, 10 * 60_000);
const text = (v: unknown) => (typeof v === "string" ? v : "");

async function view() {
  let treasury: string | null = null;
  try { treasury = (await getLaunchProvider())?.walletFor(TREASURY_WALLET).address ?? null; } catch {}
  return { ...seedsView(getStore()), treasury };
}

/** The $SEEDS pool, what each coin gave it, and every buyback and burn. */
export async function GET(): Promise<Response> {
  try {
    return apiJson(await view(), 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}

/** An admin signs an amount of the pool to spend buying back and burning $SEEDS. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const body = await readBoundedJson<Record<string, unknown>>(request, 4_096);
    await requestSeedsBurn(getStore().repo, ed25519VoteVerifier.verify.bind(ed25519VoteVerifier), adminWallets(), {
      wallet: address.parse(body.wallet), mint: text(body.mint), lamports: text(body.lamports), issuedAt: Number(body.issuedAt), nonce: text(body.nonce),
    }, text(body.signature));
    return apiJson(await view());
  } catch (error) {
    return publicRouteError(error);
  }
}
