/** An admin launches a queued coin now, ahead of its time, or removes it. Each
 * decision is a fresh, single-use signed message from an admin wallet. */
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/api-security";
import { queueDecisionMessage, type QueueDecision } from "../../lib/queue-message";
import type { LaunchseedsRepo } from "../db/repo";

type Verify = (input: { wallet: string; signature: string; message: string }) => Promise<boolean>;

export async function decideQueued(repo: Pick<LaunchseedsRepo, "launchQueue" | "challenges" | "tx">, verify: Verify, admins: string[], r: QueueDecision, signature: string, now = Date.now()) {
  if (!admins.includes(r.wallet)) throw new ApiError("Only an admin wallet can do that.", 403);
  if (!/^[a-f0-9]{32}$/.test(r.nonce) || !Number.isSafeInteger(r.issuedAt) || Math.abs(now - r.issuedAt) > 5 * 60_000) throw new ApiError("Sign a fresh request.", 400);
  if (!(await verify({ wallet: r.wallet, signature, message: queueDecisionMessage(r) }))) throw new ApiError("Signature does not match.", 403);
  const used = createHash("sha256").update(signature).digest("hex");
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(used, now)) throw new ApiError("This request was already used.", 409);
    const entry = tx.launchQueue.byKey(r.key);
    if (!entry || entry.status !== "waiting") throw new ApiError("That launch is no longer waiting.", 409);
    if (r.decision === "approve") {
      if (!tx.launchQueue.approve(entry.id, r.wallet, now)) throw new ApiError("That launch is already starting.", 409);
    } else if (!tx.launchQueue.finish(entry.id, { status: "failed", error: "Removed from the queue.", startedAt: now })) {
      throw new ApiError("That launch is no longer waiting.", 409);
    }
    return tx.launchQueue.byId(entry.id)!;
  });
}
