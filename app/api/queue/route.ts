import { ApiError, apiJson, readBoundedJson, requireSameOrigin } from "../../../lib/api-security";
import { IngressRateLimiter } from "../../../lib/trusted-client";
import { publicRouteError } from "../../../src/server/route-errors";
import { getLaunchProvider, getLaunchService, getStore } from "../../../src/server/runtime";
import { ed25519VoteVerifier } from "../../../src/integrations/ed25519";
import { address } from "../../../src/shared/domain";
import { adminWallets } from "../../../src/server/admin-wallets";
import { advanceQueue, queueList } from "../../../src/server/launch-queue";
import { decideQueued } from "../../../src/server/queue-decisions";

const limiter = new IngressRateLimiter("queue-decisions", 30, 10 * 60_000);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The launch line, in order, with no wallets; and who may decide on it. */
export async function GET(): Promise<Response> {
  try {
    return apiJson({ ...queueList(getStore()), admins: adminWallets() }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return publicRouteError(error);
  }
}

/** An admin launches a waiting coin now (`decision: "approve"`) or removes it, signed. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    if (!limiter.check(request).allowed) throw new ApiError("Too many attempts. Try again later.", 429);
    const body = await readBoundedJson<Record<string, unknown>>(request, 4_096);
    const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
    if (!decision) throw new ApiError("Launch now or remove.", 400);
    const store = getStore();
    await decideQueued(store.repo, ed25519VoteVerifier.verify.bind(ed25519VoteVerifier), adminWallets(), {
      wallet: address.parse(body.wallet), key: text(body.key), decision, issuedAt: Number(body.issuedAt), nonce: text(body.nonce),
    }, text(body.signature));
    // "Launch now" starts it at once if the treasury is free.
    const provider = await getLaunchProvider().catch(() => null);
    if (provider && decision === "approve") await advanceQueue(store, await getLaunchService(), provider);
    return apiJson({ ...queueList(store), admins: adminWallets() });
  } catch (error) {
    return publicRouteError(error);
  }
}
