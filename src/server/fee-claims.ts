/** Claims the treasury's creator vault into the treasury, so challenge payouts
 * and bundles draw on SOL the treasury actually holds. One claim at a time; an
 * unfinished claim resumes under the same id and is never started twice. */
import { randomUUID } from "node:crypto";
import type { LaunchseedsRepo } from "../db/repo";

/** Claim once the vault holds this much above its rent. */
export const CLAIM_MIN_LAMPORTS = 10_000_000n;
/** A creator vault keeps its rent-exempt minimum. */
export const VAULT_RENT_LAMPORTS = 890_880n;

export type FeeClaimChain = {
  /** The vault's SOL balance (lamports). */
  vaultLamports(): Promise<bigint>;
  /** Claims the vault into the treasury; the same id resumes the same claim. */
  claim(id: string): Promise<{ signature: string; lamports: bigint }>;
};

/** What the vault holds that is not yet in the treasury. */
export const unclaimed = (vaultLamports: bigint) => (vaultLamports > VAULT_RENT_LAMPORTS ? vaultLamports - VAULT_RENT_LAMPORTS : 0n);

export async function tickFeeClaim(repo: Pick<LaunchseedsRepo, "challenges">, chain: FeeClaimChain, now = Date.now()) {
  let pending = repo.challenges.pendingClaim();
  if (!pending) {
    if (unclaimed(await chain.vaultLamports()) < CLAIM_MIN_LAMPORTS) return "nothing to claim";
    pending = repo.challenges.startClaim(randomUUID(), now);
  }
  try {
    const result = await chain.claim(pending.claimId);
    repo.challenges.finishClaim(pending.claimId, { status: "confirmed", signature: result.signature, lamports: result.lamports.toString(), error: null }, now);
    return `claimed ${result.lamports} lamports`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim unavailable";
    // A failed claim spent only its fee; the next cycle starts a fresh one.
    if (/failed on-chain/.test(message)) repo.challenges.finishClaim(pending.claimId, { status: "failed", error: message.slice(0, 300) }, now);
    else repo.challenges.finishClaim(pending.claimId, { status: "pending", error: message.slice(0, 300) }, now);
    throw error;
  }
}
