import type { SqlDb } from "./util";

const sum = (values: string[]) => values.reduce((total, v) => total + BigInt(v), 0n);
const IN_FLIGHT = ["approved", "paying"] as const;

/** Each coin's creator fees, its challenges and their completions. */
export function challengesRepo(db: SqlDb) {
  const repo = {
    /** Records one trade's creator fee once; false when already recorded. */
    recordFee(tokenId: number, signature: string, lamports: bigint, at: number) {
      if (db.coinFees.select().where({ tokenId, signature }).get()) return false;
      db.coinFees.insert({ tokenId, signature, lamports: lamports.toString(), at });
      return true;
    },
    /** The newest trade already counted for a coin. */
    latestFee(tokenId: number) {
      return db.coinFees.select().where({ tokenId }).orderBy("at", "desc").orderBy("id", "desc").get() ?? null;
    },
    earned(tokenId: number) {
      return sum(db.coinFees.select().where({ tokenId }).all().map((f) => f.lamports));
    },
    challenge(id: number) {
      return db.challenges.select().where({ id }).get() ?? null;
    },
    challengesByToken(tokenId: number) {
      return db.challenges.select().where({ tokenId }).orderBy("id", "desc").all();
    },
    createChallenge(input: { tokenId: number; title: string; description: string; rewardLamports: bigint; maxWinners: number; createdBy: string; now: number }) {
      return db.challenges.insert({
        tokenId: input.tokenId, title: input.title, description: input.description, rewardLamports: input.rewardLamports.toString(),
        maxWinners: input.maxWinners, status: "open", createdBy: input.createdBy, createdAt: input.now,
      });
    },
    closeChallenge(id: number, now: number) {
      return db.challenges.select().where({ id, status: "open" }).updateAll({ status: "closed", closedAt: now }) > 0;
    },
    submission(id: number) {
      return db.submissions.select().where({ id }).get() ?? null;
    },
    submissionsByChallenge(challengeId: number) {
      return db.submissions.select().where({ challengeId }).orderBy("id", "asc").all();
    },
    submissionsByToken(tokenId: number) {
      return db.submissions.select().where({ tokenId }).orderBy("id", "desc").all();
    },
    /** Approved and paying completions, for the payout worker. */
    payable() {
      return db.submissions.select().where({ status: { $in: [...IN_FLIGHT] } }).orderBy("id", "asc").all();
    },
    createSubmission(input: { challengeId: number; tokenId: number; wallet: string; proofUrl: string; now: number }) {
      return db.submissions.insert({ challengeId: input.challengeId, tokenId: input.tokenId, wallet: input.wallet, proofUrl: input.proofUrl, status: "pending", createdAt: input.now });
    },
    /** Moves a submission from one status to another; false if it was not in `from`. */
    moveSubmission(id: number, from: string, patch: { status: "rejected" | "approved" | "paying" | "paid" | "review"; payoutJson?: string | null; payoutSignature?: string | null; error?: string | null; decidedAt?: number; paidAt?: number }) {
      return db.submissions.select().where({ id, status: from as never }).updateAll(patch as never) > 0;
    },
    /** A coin's challenge money: what it earned, paid out, has promised (open
     * challenges' remaining winners and approved, unpaid completions), and can
     * still promise. */
    balance(tokenId: number) {
      const earned = repo.earned(tokenId);
      const challenges = repo.challengesByToken(tokenId);
      const reward = new Map(challenges.map((c) => [c.id, BigInt(c.rewardLamports)]));
      const subs = repo.submissionsByToken(tokenId);
      let paid = 0n, inFlight = 0n;
      const used = new Map<number, number>();
      for (const s of subs) {
        const r = reward.get(s.challengeId) ?? 0n;
        if (s.status === "paid") paid += r;
        if (s.status === "approved" || s.status === "paying" || s.status === "review") inFlight += r;
        if (s.status === "paid" || s.status === "approved" || s.status === "paying" || s.status === "review") used.set(s.challengeId, (used.get(s.challengeId) ?? 0) + 1);
      }
      let open = 0n;
      for (const c of challenges)
        if (c.status === "open") open += BigInt(Math.max(0, c.maxWinners - (used.get(c.id) ?? 0))) * BigInt(c.rewardLamports);
      const promised = inFlight + open;
      const available = earned - paid - promised;
      return { earned, paid, promised, available: available > 0n ? available : 0n };
    },
    pendingClaim() {
      return db.feeClaims.select().where({ status: "pending" }).orderBy("id", "asc").get() ?? null;
    },
    startClaim(claimId: string, now: number) {
      return db.feeClaims.insert({ claimId, status: "pending", createdAt: now, updatedAt: now });
    },
    finishClaim(claimId: string, patch: { status: "pending" | "confirmed" | "failed"; signature?: string; lamports?: string; error?: string | null }, now: number) {
      return db.feeClaims.select().where({ claimId }).updateAll({ ...patch, updatedAt: now }) > 0;
    },
    /** SOL every coin can still claim: earned minus paid, across all coins. */
    owedAll() {
      const earned = sum(db.coinFees.select().all().map((f) => f.lamports));
      const rewards = new Map(db.challenges.select().all().map((c) => [c.id, BigInt(c.rewardLamports)]));
      const paid = db.submissions.select().where({ status: "paid" }).all().reduce((t, s) => t + (rewards.get(s.challengeId) ?? 0n), 0n);
      return earned > paid ? earned - paid : 0n;
    },
  };
  return repo;
}
