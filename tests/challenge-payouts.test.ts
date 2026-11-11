import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { tickPayouts, type PayoutChain } from "../src/server/challenge-payouts";

function setup() {
  const store = new Store(openLaunchseedsData(":memory:"));
  const token = insertToken(store, { status: "live", mint: Keypair.generate().publicKey.toBase58() } as never), c = store.repo.challenges;
  c.recordFee(token.id, "fee", 500_000_000n, 1);
  const wallet = Keypair.generate().publicKey.toBase58();
  const ch = c.createChallenge({ tokenId: token.id, title: "T", description: "", minRewardLamports: 10_000_000n, maxRewardLamports: 50_000_000n, maxWinners: 1, createdBy: wallet, now: 1 });
  const s = c.createSubmission({ challengeId: ch.id, tokenId: token.id, wallet, proofUrl: "https://x.com/1", requestedLamports: 40_000_000n, now: 2 });
  c.moveSubmission(s.id, "pending", { status: "approved", awardedLamports: "30000000", decidedAt: 3 });
  let n = 0, status: Awaited<ReturnType<PayoutChain["status"]>> = "unknown", expired = false, treasury = 1_000_000_000n;
  const sent: string[] = [], prepared: Array<[string, bigint]> = [];
  const chain: PayoutChain = {
    treasuryLamports: async () => treasury,
    prepare: async (to, lamports) => { prepared.push([to, lamports]); n++; return { transaction: `tx${n}`, signature: `sig${n}`, lastValidBlockHeight: 100 }; },
    send: async (tx) => { sent.push(tx); },
    status: async () => status,
    expired: async () => expired,
  };
  return { store, s, wallet, chain, sent, prepared, read: () => c.submission(s.id)!, set: (x: Partial<{ status: typeof status; expired: boolean; treasury: bigint }>) => { if (x.status) status = x.status; if (x.expired !== undefined) expired = x.expired; if (x.treasury !== undefined) treasury = x.treasury; } };
}

test("an approved completion is paid its approved amount, saved before sending and marked paid once final", async () => {
  const f = setup();
  try {
    await tickPayouts(f.store.repo, f.chain);
    expect(f.prepared).toEqual([[f.wallet, 30_000_000n]]);
    expect(f.read().status).toBe("paying");
    expect(f.read().payoutSignature).toBe("sig1");
    expect(f.sent).toEqual(["tx1"]);
    f.set({ status: "pending" });
    await tickPayouts(f.store.repo, f.chain);
    expect(f.sent).toEqual(["tx1", "tx1"]);
    expect(f.prepared).toHaveLength(1);
    f.set({ status: "finalized" });
    await tickPayouts(f.store.repo, f.chain);
    expect(f.read().status).toBe("paid");
    expect(f.store.repo.challenges.balance(f.s.tokenId).paid).toBe(30_000_000n);
  } finally { f.store.close(); }
});

test("a transfer that failed on chain is rebuilt; one expired and unseen goes to review, never paid again", async () => {
  const f = setup();
  try {
    f.set({ treasury: 30_000_000n });
    expect((await tickPayouts(f.store.repo, f.chain))[0]).toContain("waiting for treasury");
    expect(f.prepared).toHaveLength(0);
    f.set({ treasury: 1_000_000_000n });
    await tickPayouts(f.store.repo, f.chain);
    f.set({ status: "failed" });
    await tickPayouts(f.store.repo, f.chain);
    expect(f.read().status).toBe("approved");
    f.set({ status: "unknown", expired: false });
    await tickPayouts(f.store.repo, f.chain);
    expect(f.prepared).toHaveLength(2);
    f.set({ expired: true });
    await tickPayouts(f.store.repo, f.chain);
    expect(f.read().status).toBe("review");
    await tickPayouts(f.store.repo, f.chain);
    expect(f.prepared).toHaveLength(2);
    // Every attempt is kept, with what happened to it.
    expect(f.store.repo.challenges.payoutAttempts(f.s.id).map((a) => [a.signature, a.status])).toEqual([["sig1", "failed"], ["sig2", "unresolved"]]);
  } finally { f.store.close(); }
});
