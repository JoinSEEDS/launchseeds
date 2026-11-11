import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../../../lib/api-security";
import { IngressRateLimiter } from "../../../../../lib/trusted-client";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getStore } from "../../../../../src/server/runtime";
import { ed25519VoteVerifier } from "../../../../../src/integrations/ed25519";
import { address } from "../../../../../src/shared/domain";
import { challengeView } from "../../../../../src/server/challenge-view";
import { submitCompletion } from "../../../../../src/server/challenges";

const limiter = new IngressRateLimiter("submissions", 10, 10 * 60_000);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Anyone submits a completion, signed by the wallet that will be paid. */
export async function POST(request: Request, { params }: { params: Promise<{ mint: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const mint = (await params).mint, body = await readBoundedJson<Record<string, unknown>>(request, 4_096);
    const store = getStore(), token = store.repo.tokens.getByMint(mint);
    await submitCompletion(store.repo, ed25519VoteVerifier.verify.bind(ed25519VoteVerifier), token, {
      wallet: address.parse(body.wallet), mint, issuedAt: Number(body.issuedAt), nonce: text(body.nonce),
      challengeId: Number(body.challengeId), proofUrl: text(body.proofUrl), requestedLamports: text(body.requestedLamports),
    }, text(body.signature));
    return apiJson(challengeView(store, token!.id));
  } catch (error) {
    return publicRouteError(error);
  }
}
