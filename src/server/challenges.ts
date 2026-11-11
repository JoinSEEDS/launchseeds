/** Challenge rules. The coin's creator (the wallet that signed its launch) posts
 * challenges with a reward range and closes them; anyone submits a completion
 * asking an amount in that range; the creator approves it with the amount paid,
 * or rejects it. Every action is a fresh, signed, single-use message. */
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/api-security";
import {
  challengeCloseMessage, challengePostMessage, decisionMessage, reviewMessage, submissionMessage,
  type ChallengeClose, type ChallengePost, type Decision, type ReviewResolution, type SubmissionPost,
} from "../../lib/challenge-message";
import type { LaunchseedsRepo } from "../db/repo";
import type { Token } from "../db/schema";

export const MIN_REWARD_LAMPORTS = 1_000_000n; // 0.001 SOL
const MAX_AGE_MS = 5 * 60_000;
type Repo = Pick<LaunchseedsRepo, "challenges" | "tokens" | "tx">;
type Verify = (input: { wallet: string; signature: string; message: string }) => Promise<boolean>;
const lamports = (value: string, what: string) => {
  if (!/^\d{1,19}$/.test(value)) throw new ApiError(`Enter ${what} in lamports.`, 400);
  return BigInt(value);
};
const httpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || value.length > 300) throw new Error();
    return url.toString();
  } catch {
    throw new ApiError("Proof must be an https link.", 400);
  }
};

async function checkSigned(repo: Repo, verify: Verify, r: { wallet: string; issuedAt: number; nonce: string }, signature: string, message: string, now: number) {
  if (!/^[a-f0-9]{32}$/.test(r.nonce) || Math.abs(now - r.issuedAt) > MAX_AGE_MS) throw new ApiError("Sign a fresh request.", 400);
  if (!(await verify({ wallet: r.wallet, signature, message }))) throw new ApiError("Signature does not match.", 403);
  return createHash("sha256").update(signature).digest("hex");
}
function liveCoin(token: Token | null | undefined) {
  if (!token?.mint || token.status !== "live") throw new ApiError("Coin not found.", 404);
  return token;
}
const creatorOnly = (token: Token, wallet: string) => {
  if (!token.creatorWallet || token.creatorWallet !== wallet) throw new ApiError("Only this coin's creator can do that.", 403);
};

export async function postChallenge(repo: Repo, verify: Verify, token: Token | null | undefined, r: ChallengePost, signature: string, now = Date.now()) {
  const coin = liveCoin(token);
  creatorOnly(coin, r.wallet);
  if (r.mint !== coin.mint) throw new ApiError("Signed for another coin.", 400);
  const title = r.title.trim(), description = r.description.trim();
  if (!title || title.length > 120 || description.length > 2000) throw new ApiError("Give the challenge a title up to 120 characters and a description up to 2,000.", 400);
  const min = lamports(r.minRewardLamports, "the minimum reward"), max = lamports(r.maxRewardLamports, "the maximum reward");
  if (min < MIN_REWARD_LAMPORTS || max < min) throw new ApiError("The reward range must start at 0.001 SOL or more and end at or above its start.", 400);
  if (!Number.isInteger(r.maxWinners) || r.maxWinners < 1 || r.maxWinners > 100) throw new ApiError("Choose 1 to 100 winners.", 400);
  const key = await checkSigned(repo, verify, r, signature, challengePostMessage(r), now);
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(key, now)) throw new ApiError("This request was already used.", 409);
    const need = max * BigInt(r.maxWinners), { available } = tx.challenges.balance(coin.id);
    if (need > available) throw new ApiError(`This coin's fees cover ${available} lamports; this challenge needs ${need}.`, 400);
    return tx.challenges.createChallenge({ tokenId: coin.id, title, description, minRewardLamports: min, maxRewardLamports: max, maxWinners: r.maxWinners, createdBy: r.wallet, now });
  });
}

export async function closeChallenge(repo: Repo, verify: Verify, token: Token | null | undefined, r: ChallengeClose, signature: string, now = Date.now()) {
  const coin = liveCoin(token);
  creatorOnly(coin, r.wallet);
  const key = await checkSigned(repo, verify, r, signature, challengeCloseMessage(r), now);
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(key, now)) throw new ApiError("This request was already used.", 409);
    const challenge = tx.challenges.challenge(r.challengeId);
    if (!challenge || challenge.tokenId !== coin.id) throw new ApiError("Challenge not found.", 404);
    return tx.challenges.closeChallenge(challenge.id, now);
  });
}

export async function submitCompletion(repo: Repo, verify: Verify, token: Token | null | undefined, r: SubmissionPost, signature: string, now = Date.now()) {
  const coin = liveCoin(token);
  const proofUrl = httpsUrl(r.proofUrl);
  const requested = lamports(r.requestedLamports, "the amount you ask for");
  const note = (r.note ?? "").trim();
  if (note.length > 500) throw new ApiError("Keep the note under 500 characters.", 400);
  const key = await checkSigned(repo, verify, r, signature, submissionMessage(r), now);
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(key, now)) throw new ApiError("This request was already used.", 409);
    const challenge = tx.challenges.challenge(r.challengeId);
    if (!challenge || challenge.tokenId !== coin.id) throw new ApiError("Challenge not found.", 404);
    if (challenge.status !== "open") throw new ApiError("This challenge is closed.", 409);
    if (requested < BigInt(challenge.minRewardLamports) || requested > BigInt(challenge.maxRewardLamports)) throw new ApiError("Ask for an amount inside the challenge's range.", 400);
    const mine = tx.challenges.submissionsByChallenge(challenge.id).filter((s) => s.wallet === r.wallet && s.status !== "rejected");
    if (mine.length) throw new ApiError("You already submitted to this challenge.", 409);
    return tx.challenges.createSubmission({ challengeId: challenge.id, tokenId: coin.id, wallet: r.wallet, proofUrl, note, requestedLamports: requested, now });
  });
}

export async function decide(repo: Repo, verify: Verify, token: Token | null | undefined, r: Decision, signature: string, now = Date.now()) {
  const coin = liveCoin(token);
  creatorOnly(coin, r.wallet);
  const awarded = r.decision === "approve" ? lamports(r.awardedLamports, "the amount paid") : 0n;
  const key = await checkSigned(repo, verify, r, signature, decisionMessage(r), now);
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(key, now)) throw new ApiError("This request was already used.", 409);
    const submission = tx.challenges.submission(r.submissionId);
    if (!submission || submission.tokenId !== coin.id) throw new ApiError("Submission not found.", 404);
    if (submission.status !== "pending") throw new ApiError("This submission was already decided.", 409);
    if (r.decision === "reject") return tx.challenges.moveSubmission(submission.id, "pending", { status: "rejected", decidedAt: now });
    const challenge = tx.challenges.challenge(submission.challengeId)!;
    if (awarded < BigInt(challenge.minRewardLamports) || awarded > BigInt(challenge.maxRewardLamports)) throw new ApiError("Pay an amount inside the challenge's range.", 400);
    const winners = tx.challenges.submissionsByChallenge(challenge.id).filter((s) => !["pending", "rejected"].includes(s.status)).length;
    if (winners >= challenge.maxWinners) throw new ApiError("This challenge already has all its winners.", 409);
    // A closed challenge no longer holds money aside, so its approvals need free balance.
    if (challenge.status === "closed" && awarded > tx.challenges.balance(coin.id).available) throw new ApiError("This coin's fees no longer cover that amount.", 400);
    return tx.challenges.moveSubmission(submission.id, "pending", { status: "approved", awardedLamports: awarded.toString(), decidedAt: now });
  });
}

/** An admin settles a payout that went to review because its transfer's outcome
 * was unclear: "paid" once the chain shows it landed, "retry" to pay afresh. */
export async function resolveReview(repo: Repo, verify: Verify, token: Token | null | undefined, admins: string[], r: ReviewResolution, signature: string, now = Date.now()) {
  const coin = liveCoin(token);
  if (!admins.includes(r.wallet)) throw new ApiError("Only an admin wallet can do that.", 403);
  if (r.mint !== coin.mint) throw new ApiError("Signed for another coin.", 400);
  const key = await checkSigned(repo, verify, r, signature, reviewMessage(r), now);
  return repo.tx((tx) => {
    if (!tx.challenges.useSignature(key, now)) throw new ApiError("This request was already used.", 409);
    const submission = tx.challenges.submission(r.submissionId);
    if (!submission || submission.tokenId !== coin.id) throw new ApiError("Submission not found.", 404);
    if (submission.status !== "review") throw new ApiError("This payout is not waiting for review.", 409);
    if (r.resolution === "paid") {
      if (submission.payoutSignature) tx.challenges.markAttempt(submission.payoutSignature, "landed", now);
      return tx.challenges.moveSubmission(submission.id, "review", { status: "paid", paidAt: now, error: null });
    }
    return tx.challenges.moveSubmission(submission.id, "review", { status: "approved", payoutJson: null, payoutSignature: null, error: null });
  });
}
