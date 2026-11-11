/** Pays approved challenge completions from the treasury. Every signed transfer
 * is saved as a permanent attempt before it is sent, and a submission is marked
 * paid only once its transfer is finalized. A fresh transfer is built only when
 * the last one failed on chain; one whose outcome can't be shown (expired and
 * not found) goes to review instead, so nobody is paid twice. */
import type { LaunchseedsRepo } from "../db/repo";

export type Signed = { transaction: string; signature: string; lastValidBlockHeight: number };
export type PayoutChain = {
  treasuryLamports(): Promise<bigint>;
  /** A signed SOL transfer from the treasury; not sent. */
  prepare(to: string, lamports: bigint): Promise<Signed>;
  send(transaction: string): Promise<void>;
  status(signature: string): Promise<"finalized" | "confirmed" | "failed" | "pending" | "unknown">;
  /** True once the finalized block height is past `height`. */
  expired(height: number): Promise<boolean>;
};
/** Kept in the treasury for the transfer's own network fee. */
const FEE_MARGIN = 1_000_000n;

export async function tickPayouts(repo: Pick<LaunchseedsRepo, "challenges">, chain: PayoutChain, now = Date.now()) {
  const lines: string[] = [];
  for (const s of repo.challenges.payable()) {
    const label = `payout ${s.id}`;
    try {
      const amount = BigInt(s.awardedLamports ?? "0");
      if (s.status === "approved") {
        if (amount <= 0n) { repo.challenges.moveSubmission(s.id, "approved", { status: "review", error: "Approved without an amount" }); continue; }
        if ((await chain.treasuryLamports()) < amount + FEE_MARGIN) { lines.push(`${label}: waiting for treasury SOL`); continue; }
        const signed = await chain.prepare(s.wallet, amount);
        if (!repo.challenges.startPayout(s.id, signed, now)) continue;
        await chain.send(signed.transaction);
        lines.push(`${label}: sent ${amount} lamports`);
        continue;
      }
      const signed = JSON.parse(s.payoutJson ?? "null") as Signed | null;
      if (!signed) { repo.challenges.moveSubmission(s.id, "paying", { status: "review", error: "Payout journal missing" }); continue; }
      const status = await chain.status(signed.signature);
      if (status === "finalized") {
        repo.challenges.markAttempt(signed.signature, "landed", now);
        repo.challenges.moveSubmission(s.id, "paying", { status: "paid", paidAt: now, error: null });
        lines.push(`${label}: paid`);
      } else if (status === "failed") {
        // A failed transfer moved nothing but its fee; build a fresh one.
        repo.challenges.markAttempt(signed.signature, "failed", now);
        repo.challenges.moveSubmission(s.id, "paying", { status: "approved", payoutJson: null, payoutSignature: null, error: "Previous transfer failed on chain" });
        lines.push(`${label}: failed on chain, will retry`);
      } else if (status === "unknown" && (await chain.expired(signed.lastValidBlockHeight)) && (await chain.status(signed.signature)) === "unknown") {
        // Expiry stops it landing from now on, but an RPC may simply not show it
        // landed: never pay again on that; an operator checks the chain.
        repo.challenges.markAttempt(signed.signature, "unresolved", now);
        repo.challenges.moveSubmission(s.id, "paying", { status: "review", error: `Transfer ${signed.signature} expired and was not found; check on chain before paying again` });
        lines.push(`${label}: outcome unknown, sent to review`);
      } else if (status !== "confirmed" && !(await chain.expired(signed.lastValidBlockHeight))) {
        await chain.send(signed.transaction);
      }
    } catch (error) {
      lines.push(`${label}: ${error instanceof Error ? error.message : "unavailable"}`);
    }
  }
  return lines;
}
