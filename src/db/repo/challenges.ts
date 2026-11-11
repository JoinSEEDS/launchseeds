import type { SqlDb } from "./util";
import { seedsCut, seedsMint, seedsShareBps } from "../../domain/seeds-split";

const sum = (values: string[]) => values.reduce((total, v) => total + BigInt(v), 0n);
const IN_FLIGHT = ["approved", "paying"] as const;
const BURN_ACTIVE = ["queued", "buying", "bought", "burning", "review"] as const;
export type SeedsSplit = { bps: () => number; mint: () => string | null };
const envSplit: SeedsSplit = { bps: () => seedsShareBps(), mint: () => seedsMint() };

/** Each coin's creator fees, its challenges and their completions. */
export function challengesRepo(db: SqlDb, split: SeedsSplit = envSplit) {
  const seedsTokenId = () => {
    const mint = split.mint();
    return mint ? (db.tokens.select().where({ mint }).get()?.id ?? null) : null;
  };
  /** Every coin's raw creator fees, by token id. */
  const rawByToken = () => {
    const out = new Map<number, bigint>();
    for (const f of db.coinFees.select().all()) out.set(f.tokenId, (out.get(f.tokenId) ?? 0n) + BigInt(f.lamports));
    return out;
  };
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
    /** All the creator fees a coin's trades paid. */
    rawFees(tokenId: number) {
      return sum(db.coinFees.select().where({ tokenId }).all().map((f) => f.lamports));
    },
    /** What a coin keeps for its challenges: its fees less the $SEEDS share.
     * $SEEDS itself keeps nothing for challenges; all of its fees are its pool. */
    earned(tokenId: number) {
      const raw = repo.rawFees(tokenId);
      return tokenId === seedsTokenId() ? 0n : raw - seedsCut(raw, split.bps());
    },
    challenge(id: number) {
      return db.challenges.select().where({ id }).get() ?? null;
    },
    challengesByToken(tokenId: number) {
      return db.challenges.select().where({ tokenId }).orderBy("id", "desc").all();
    },
    createChallenge(input: { tokenId: number; title: string; description: string; minRewardLamports: bigint; maxRewardLamports: bigint; maxWinners: number; createdBy: string; now: number }) {
      return db.challenges.insert({
        tokenId: input.tokenId, title: input.title, description: input.description,
        minRewardLamports: input.minRewardLamports.toString(), maxRewardLamports: input.maxRewardLamports.toString(),
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
    createSubmission(input: { challengeId: number; tokenId: number; wallet: string; proofUrl: string; note?: string; requestedLamports: bigint; now: number }) {
      return db.submissions.insert({ challengeId: input.challengeId, tokenId: input.tokenId, wallet: input.wallet, proofUrl: input.proofUrl, note: input.note ?? "", requestedLamports: input.requestedLamports.toString(), status: "pending", createdAt: input.now });
    },
    /** Moves a submission from one status to another; false if it was not in `from`. */
    moveSubmission(id: number, from: string, patch: { status: "rejected" | "approved" | "paying" | "paid" | "review"; awardedLamports?: string; payoutJson?: string | null; payoutSignature?: string | null; error?: string | null; decidedAt?: number; paidAt?: number }) {
      return db.submissions.select().where({ id, status: from as never }).updateAll(patch as never) > 0;
    },
    /** A coin's challenge money: what it earned, paid out, has promised (open
     * challenges' remaining winners at their maximum, and approved, unpaid
     * completions at their approved amount), and can still promise. */
    balance(tokenId: number) {
      const earned = repo.earned(tokenId);
      const challenges = repo.challengesByToken(tokenId);
      let paid = 0n, inFlight = 0n;
      const used = new Map<number, number>();
      for (const s of repo.submissionsByToken(tokenId)) {
        const awarded = BigInt(s.awardedLamports ?? "0");
        if (s.status === "paid") paid += awarded;
        if (s.status === "approved" || s.status === "paying" || s.status === "review") inFlight += awarded;
        if (s.status !== "pending" && s.status !== "rejected") used.set(s.challengeId, (used.get(s.challengeId) ?? 0) + 1);
      }
      let open = 0n;
      for (const c of challenges)
        if (c.status === "open") open += BigInt(Math.max(0, c.maxWinners - (used.get(c.id) ?? 0))) * BigInt(c.maxRewardLamports);
      const promised = inFlight + open;
      const available = earned - paid - promised;
      return { earned, paid, promised, available: available > 0n ? available : 0n };
    },
    /** Saves a signed payout transfer as a permanent attempt and moves the
     * submission to paying, together; false if it was no longer approved. */
    startPayout(id: number, signed: { transaction: string; signature: string; lastValidBlockHeight: number }, now: number) {
      return db.transaction(() => {
        if (!(db.submissions.select().where({ id, status: "approved" }).updateAll({ status: "paying", payoutJson: JSON.stringify(signed), payoutSignature: signed.signature, error: null }) > 0)) return false;
        db.payoutAttempts.insert({ submissionId: id, signature: signed.signature, transactionJson: JSON.stringify(signed), lastValidBlockHeight: signed.lastValidBlockHeight, status: "sent", createdAt: now, updatedAt: now });
        return true;
      });
    },
    markAttempt(signature: string, status: "landed" | "failed" | "unresolved", now: number) {
      return db.payoutAttempts.select().where({ signature }).updateAll({ status, updatedAt: now }) > 0;
    },
    payoutAttempts(submissionId: number) {
      return db.payoutAttempts.select().where({ submissionId }).orderBy("id", "asc").all();
    },
    /** Records a signed action once; false when that signature was used before. */
    useSignature(key: string, now: number) {
      if (db.signedActions.select().where({ key }).get()) return false;
      db.signedActions.insert({ key, at: now });
      return true;
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
    /** Coins' challenge SOL that is in the treasury now: fees claimed into it
     * (never more than the coins earned) minus what was paid out. Bundles leave it alone. */
    owedInTreasury() {
      const earned = sum(db.coinFees.select().all().map((f) => f.lamports));
      const claimed = sum(db.feeClaims.select().where({ status: "confirmed" }).all().map((c) => c.lamports));
      const paid = sum(db.submissions.select().where({ status: "paid" }).all().map((s) => s.awardedLamports ?? "0"));
      const burned = sum(db.seedsBurns.select().where({ status: "done" }).all().map((b) => b.spentLamports ?? b.lamports));
      const held = (claimed < earned ? claimed : earned) - paid - burned;
      return held > 0n ? held : 0n;
    },
    /** The $SEEDS pool: its share of every coin's fees plus all of its own,
     * what buybacks spent or hold, and what can be spent now (only SOL already
     * claimed into the treasury and not owed to any coin's challenges). */
    seedsPool() {
      const bps = split.bps(), seedsId = seedsTokenId(), raw = rawByToken();
      let accrued = 0n, total = 0n;
      const contributions: { tokenId: number; feesLamports: bigint; seedsLamports: bigint }[] = [];
      for (const [tokenId, fees] of raw) {
        const cut = tokenId === seedsId ? fees : seedsCut(fees, bps);
        accrued += cut; total += fees;
        contributions.push({ tokenId, feesLamports: fees, seedsLamports: cut });
      }
      const burns = db.seedsBurns.select().all();
      const spent = sum(burns.filter((b) => b.status === "done").map((b) => b.spentLamports ?? b.lamports));
      const held = sum(burns.filter((b) => (BURN_ACTIVE as readonly string[]).includes(b.status)).map((b) => b.lamports));
      const claimed = sum(db.feeClaims.select().where({ status: "confirmed" }).all().map((c) => c.lamports));
      const inTreasury = (claimed < total ? claimed : total) - (total - accrued) - spent - held;
      const left = accrued - spent - held;
      const spendable = left < inTreasury ? left : inTreasury;
      return { bps, accrued, spent, held, spendable: spendable > 0n ? spendable : 0n, contributions: contributions.sort((a, b) => (b.seedsLamports > a.seedsLamports ? 1 : -1)) };
    },
    seedsBurns() {
      return db.seedsBurns.select().orderBy("id", "desc").all();
    },
    activeSeedsBurn() {
      return db.seedsBurns.select().where({ status: { $in: ["queued", "buying", "bought", "burning"] } }).orderBy("id", "asc").get() ?? null;
    },
    /** Queues an authorized buyback if none is running and the pool covers it. */
    queueSeedsBurn(input: { requestKey: string; authorizedBy: string; mint: string; lamports: bigint; now: number }) {
      return db.transaction(() => {
        const same = db.seedsBurns.select().where({ requestKey: input.requestKey }).get();
        if (same) return { burn: same, error: null };
        if (db.seedsBurns.select().where({ status: { $in: [...BURN_ACTIVE] } }).get()) return { burn: null, error: "A buyback is already running or waiting for review." };
        if (input.lamports > repo.seedsPool().spendable) return { burn: null, error: "The $SEEDS pool does not cover that amount yet." };
        return { burn: db.seedsBurns.insert({ requestKey: input.requestKey, authorizedBy: input.authorizedBy, mint: input.mint, lamports: input.lamports.toString(), status: "queued", createdAt: input.now, updatedAt: input.now }), error: null };
      });
    },
    /** Moves a buyback from one step to the next; false if it was not at `from`. */
    moveSeedsBurn(id: number, from: string, patch: Record<string, unknown> & { status: "queued" | "buying" | "bought" | "burning" | "done" | "review" }, now: number) {
      return db.seedsBurns.select().where({ id, status: from as never }).updateAll({ ...patch, updatedAt: now } as never) > 0;
    },
    seedsBurn(id: number) {
      return db.seedsBurns.select().where({ id }).get() ?? null;
    },
    /** SOL every coin can still claim: earned minus paid, across all coins. */
    owedAll() {
      const earned = sum(db.coinFees.select().all().map((f) => f.lamports));
      const paid = sum(db.submissions.select().where({ status: "paid" }).all().map((s) => s.awardedLamports ?? "0"));
      return earned > paid ? earned - paid : 0n;
    },
  };
  return repo;
}
