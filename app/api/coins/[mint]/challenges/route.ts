import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../../../lib/api-security";
import { IngressRateLimiter } from "../../../../../lib/trusted-client";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getLaunchProvider, getStore } from "../../../../../src/server/runtime";
import { TREASURY_WALLET } from "../../../../../src/server/treasury";
import { ed25519VoteVerifier } from "../../../../../src/integrations/ed25519";
import { address } from "../../../../../src/shared/domain";
import { challengeView } from "../../../../../src/server/challenge-view";
import { closeChallenge, postChallenge } from "../../../../../src/server/challenges";

const limiter = new IngressRateLimiter("challenges", 20, 10 * 60_000);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const verify = ed25519VoteVerifier.verify.bind(ed25519VoteVerifier);
const coin = (mint: string) => getStore().repo.tokens.getByMint(mint);

/** A coin's challenge board. */
export async function GET(_request: Request, { params }: { params: Promise<{ mint: string }> }): Promise<Response> {
  try {
    const token = coin((await params).mint);
    if (!token?.mint || token.status !== "live") throw new ApiError("Coin not found.", 404);
    let treasury: string | null = null;
    try { treasury = (await getLaunchProvider())?.walletFor(TREASURY_WALLET).address ?? null; } catch {}
    return apiJson({ ...challengeView(getStore(), token.id), treasury }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}

/** The creator posts (`action: "post"`) or closes (`action: "close"`) a challenge, signed. */
export async function POST(request: Request, { params }: { params: Promise<{ mint: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const mint = (await params).mint, body = await readBoundedJson<Record<string, unknown>>(request, 8_192);
    const signed = { wallet: address.parse(body.wallet), mint, issuedAt: Number(body.issuedAt), nonce: text(body.nonce) };
    const store = getStore();
    if (body.action === "close") {
      await closeChallenge(store.repo, verify, coin(mint), { ...signed, challengeId: Number(body.challengeId) }, text(body.signature));
    } else {
      await postChallenge(store.repo, verify, coin(mint), {
        ...signed, title: text(body.title), description: text(body.description),
        minRewardLamports: text(body.minRewardLamports), maxRewardLamports: text(body.maxRewardLamports), maxWinners: Number(body.maxWinners),
      }, text(body.signature));
    }
    return apiJson(challengeView(store, coin(mint)!.id));
  } catch (error) {
    return publicRouteError(error);
  }
}
