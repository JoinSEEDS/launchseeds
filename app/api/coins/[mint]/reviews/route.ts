import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../../../lib/api-security";
import { IngressRateLimiter } from "../../../../../lib/trusted-client";
import { publicRouteError } from "../../../../../src/server/route-errors";
import { getStore } from "../../../../../src/server/runtime";
import { ed25519VoteVerifier } from "../../../../../src/integrations/ed25519";
import { address } from "../../../../../src/shared/domain";
import { challengeView } from "../../../../../src/server/challenge-view";
import { resolveReview } from "../../../../../src/server/challenges";
import { adminWallets } from "../../../../../src/server/admin-wallets";
import { notifyLaunchWorker } from "../../../../../src/server/launch-wake";

const limiter = new IngressRateLimiter("payout-reviews", 20, 10 * 60_000);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** An admin marks a payout in review as paid, or has it paid again, signed. */
export async function POST(request: Request, { params }: { params: Promise<{ mint: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const mint = (await params).mint, body = await readBoundedJson<Record<string, unknown>>(request, 2_048);
    const store = getStore(), token = store.repo.tokens.getByMint(mint);
    await resolveReview(store.repo, ed25519VoteVerifier.verify.bind(ed25519VoteVerifier), token, adminWallets(), {
      wallet: address.parse(body.wallet), mint, issuedAt: Number(body.issuedAt), nonce: text(body.nonce),
      submissionId: Number(body.submissionId), resolution: body.resolution === "paid" ? "paid" : "retry",
    }, text(body.signature));
    notifyLaunchWorker();
    return apiJson(challengeView(store, token!.id));
  } catch (error) {
    return publicRouteError(error);
  }
}
