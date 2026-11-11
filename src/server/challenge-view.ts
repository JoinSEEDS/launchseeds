/** A coin's public challenge board: its money, its challenges and every
 * submission with what was asked and what was paid. Amounts are lamport strings. */
import type { Store } from "./store";
import { adminWallets } from "./admin-wallets";

export function challengeView(store: Store, tokenId: number) {
  const token = store.repo.tokens.get(tokenId);
  const c = store.repo.challenges;
  const balance = c.balance(tokenId);
  const submissions = c.submissionsByToken(tokenId);
  return {
    creatorWallet: token?.creatorWallet ?? null,
    /** Wallets that may settle payouts in review. */
    admins: adminWallets(),
    balance: { earned: String(balance.earned), paid: String(balance.paid), promised: String(balance.promised), available: String(balance.available) },
    challenges: c.challengesByToken(tokenId).map((ch) => {
      const mine = submissions.filter((s) => s.challengeId === ch.id).sort((a, b) => a.id - b.id);
      return {
        id: ch.id, title: ch.title, description: ch.description, status: ch.status, createdAt: ch.createdAt,
        minRewardLamports: ch.minRewardLamports, maxRewardLamports: ch.maxRewardLamports, maxWinners: ch.maxWinners,
        winners: mine.filter((s) => !["pending", "rejected"].includes(s.status)).length,
        submissions: mine.map((s) => ({
          id: s.id, wallet: s.wallet, proofUrl: s.proofUrl, status: s.status, createdAt: s.createdAt,
          requestedLamports: s.requestedLamports, awardedLamports: s.awardedLamports, payoutSignature: s.status === "paid" || s.status === "review" ? s.payoutSignature : null,
        })),
      };
    }),
  };
}
export type ChallengeView = ReturnType<typeof challengeView>;
