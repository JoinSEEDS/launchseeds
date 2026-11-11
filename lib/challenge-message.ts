import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

const digest = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const head = (title: string, wallet: string, mint: string, issuedAt: number, nonce: string) =>
  `LaunchSeeds ${title}\nCoin: ${mint}\nWallet: ${wallet}`;
const tail = (issuedAt: number, nonce: string) => `Nonce: ${nonce}\nIssued: ${new Date(issuedAt).toISOString()}`;

type Signed = { wallet: string; mint: string; issuedAt: number; nonce: string };

/** The coin's creator posts a challenge. Amounts are lamports. */
export type ChallengePost = Signed & { title: string; description: string; minRewardLamports: string; maxRewardLamports: string; maxWinners: number };
export const challengePostMessage = (r: ChallengePost) =>
  `${head("challenge", r.wallet, r.mint, r.issuedAt, r.nonce)}
Title: ${r.title}
Reward: ${r.minRewardLamports}-${r.maxRewardLamports} lamports, up to ${r.maxWinners} winners
Details: ${digest([r.description])}
${tail(r.issuedAt, r.nonce)}`;

/** The coin's creator closes a challenge. */
export type ChallengeClose = Signed & { challengeId: number };
export const challengeCloseMessage = (r: ChallengeClose) =>
  `${head("close challenge", r.wallet, r.mint, r.issuedAt, r.nonce)}
Challenge: ${r.challengeId}
${tail(r.issuedAt, r.nonce)}`;

/** Anyone submits a completion, paid to the signing wallet, asking an amount in the range. */
export type SubmissionPost = Signed & { challengeId: number; proofUrl: string; requestedLamports: string; note?: string };
export const submissionMessage = (r: SubmissionPost) =>
  `${head("submission", r.wallet, r.mint, r.issuedAt, r.nonce)}
Challenge: ${r.challengeId}
Asking: ${r.requestedLamports} lamports
Proof: ${r.proofUrl}
Note: ${digest([r.note ?? ""])}
${tail(r.issuedAt, r.nonce)}`;

/** The coin's creator approves (with the amount paid) or rejects a submission. */
export type Decision = Signed & { submissionId: number; decision: "approve" | "reject"; awardedLamports: string };
export const decisionMessage = (r: Decision) =>
  `${head(r.decision === "approve" ? "approve" : "reject", r.wallet, r.mint, r.issuedAt, r.nonce)}
Submission: ${r.submissionId}
${r.decision === "approve" ? `Pay: ${r.awardedLamports} lamports\n` : ""}${tail(r.issuedAt, r.nonce)}`;

/** An admin resolves a payout in review: "paid" after seeing its transfer landed,
 * or "retry" to have the worker send a fresh one. */
export type ReviewResolution = Signed & { submissionId: number; resolution: "paid" | "retry" };
export const reviewMessage = (r: ReviewResolution) =>
  `${head(r.resolution === "paid" ? "mark payout paid" : "pay again", r.wallet, r.mint, r.issuedAt, r.nonce)}
Submission: ${r.submissionId}
${tail(r.issuedAt, r.nonce)}`;
