import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";
import { challengeCloseMessage, challengePostMessage, decisionMessage, submissionMessage } from "../lib/challenge-message";
import { closeChallenge, decide, postChallenge, submitCompletion } from "../src/server/challenges";

const now = 1_800_000_000_000;
const sign = (pair: Keypair, message: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), pair.secretKey.slice(0, 32)));
let n = 0;
const nonce = () => (++n).toString(16).padStart(32, "0");
const verify = ed25519VoteVerifier.verify.bind(ed25519VoteVerifier);

function setup(earned = 200_000_000n) {
  const store = new Store(openLaunchseedsData(":memory:"));
  const creator = Keypair.generate(), mint = Keypair.generate().publicKey.toBase58();
  const token = insertToken(store, { status: "live", mint, creatorWallet: creator.publicKey.toBase58() } as never);
  store.repo.challenges.recordFee(token.id, "fee", earned, 1);
  const coin = () => store.repo.tokens.get(token.id);
  const post = (pair: Keypair, over: Partial<{ min: string; max: string; winners: number }> = {}) => {
    const r = { wallet: pair.publicKey.toBase58(), mint, issuedAt: now, nonce: nonce(), title: "Post a video", description: "On X", minRewardLamports: over.min ?? "10000000", maxRewardLamports: over.max ?? "50000000", maxWinners: over.winners ?? 2 };
    return postChallenge(store.repo, verify, coin(), r, sign(pair, challengePostMessage(r)), now);
  };
  const submit = (pair: Keypair, challengeId: number, asking = "30000000") => {
    const r = { wallet: pair.publicKey.toBase58(), mint, issuedAt: now, nonce: nonce(), challengeId, proofUrl: "https://x.com/a/status/1", requestedLamports: asking };
    return submitCompletion(store.repo, verify, coin(), r, sign(pair, submissionMessage(r)), now);
  };
  const decision = (pair: Keypair, submissionId: number, d: "approve" | "reject", paid = "25000000") => {
    const r = { wallet: pair.publicKey.toBase58(), mint, issuedAt: now, nonce: nonce(), submissionId, decision: d, awardedLamports: paid };
    return decide(store.repo, verify, coin(), r, sign(pair, decisionMessage(r)), now);
  };
  return { store, creator, mint, token, coin, post, submit, decision };
}

test("only the creator posts, within the coin's fees, and each signature works once", async () => {
  const f = setup();
  try {
    await expect(f.post(Keypair.generate())).rejects.toThrow("Only this coin's creator");
    await expect(f.post(f.creator, { max: "200000000", winners: 2 })).rejects.toThrow("fees cover");
    await expect(f.post(f.creator, { min: "60000000", max: "50000000" })).rejects.toThrow("range");
    const challenge = await f.post(f.creator);
    expect(f.store.repo.challenges.balance(f.token.id).promised).toBe(100_000_000n);
    const r = { wallet: f.creator.publicKey.toBase58(), mint: f.mint, issuedAt: now, nonce: nonce(), challengeId: challenge.id };
    const signature = sign(f.creator, challengeCloseMessage(r));
    expect(await closeChallenge(f.store.repo, verify, f.coin(), r, signature, now)).toBe(true);
    await expect(closeChallenge(f.store.repo, verify, f.coin(), r, signature, now)).rejects.toThrow("already used");
  } finally { f.store.close(); }
});

test("anyone submits once, asking inside the range; the creator pays an amount inside it", async () => {
  const f = setup();
  try {
    const challenge = await f.post(f.creator), alice = Keypair.generate(), bob = Keypair.generate();
    await expect(f.submit(alice, challenge.id, "60000000")).rejects.toThrow("inside the challenge's range");
    const a = await f.submit(alice, challenge.id, "45000000");
    await expect(f.submit(alice, challenge.id)).rejects.toThrow("already submitted");
    expect(f.store.repo.challenges.submission(a.id)?.requestedLamports).toBe("45000000");
    await expect(f.decision(alice, a.id, "approve")).rejects.toThrow("Only this coin's creator");
    await expect(f.decision(f.creator, a.id, "approve", "90000000")).rejects.toThrow("inside the challenge's range");
    expect(await f.decision(f.creator, a.id, "approve", "25000000")).toBe(true);
    const paid = f.store.repo.challenges.submission(a.id)!;
    expect([paid.requestedLamports, paid.awardedLamports, paid.status]).toEqual(["45000000", "25000000", "approved"]);
    await expect(f.decision(f.creator, a.id, "reject")).rejects.toThrow("already decided");
    const b = await f.submit(bob, challenge.id);
    expect(await f.decision(f.creator, b.id, "reject")).toBe(true);
    expect(f.store.repo.challenges.submission(b.id)?.status).toBe("rejected");
  } finally { f.store.close(); }
});

test("a challenge pays no more than its winners", async () => {
  const f = setup();
  try {
    const challenge = await f.post(f.creator, { winners: 1 });
    const a = await f.submit(Keypair.generate(), challenge.id), b = await f.submit(Keypair.generate(), challenge.id);
    expect(await f.decision(f.creator, a.id, "approve")).toBe(true);
    await expect(f.decision(f.creator, b.id, "approve")).rejects.toThrow("all its winners");
  } finally { f.store.close(); }
});

test("a tampered or stale request is refused", async () => {
  const f = setup();
  try {
    const challenge = await f.post(f.creator), alice = Keypair.generate();
    const r = { wallet: alice.publicKey.toBase58(), mint: f.mint, issuedAt: now, nonce: nonce(), challengeId: challenge.id, proofUrl: "https://x.com/a/status/1", requestedLamports: "20000000" };
    const signature = sign(alice, submissionMessage(r));
    await expect(submitCompletion(f.store.repo, verify, f.coin(), { ...r, requestedLamports: "50000000" }, signature, now)).rejects.toThrow("Signature does not match");
    await expect(submitCompletion(f.store.repo, verify, f.coin(), r, signature, now + 10 * 60_000)).rejects.toThrow("fresh");
    await expect(submitCompletion(f.store.repo, verify, f.coin(), { ...r, proofUrl: "http://x.com" }, signature, now)).rejects.toThrow("https");
  } finally { f.store.close(); }
});

test("only an admin settles a payout in review: marked paid, or sent back to pay again", async () => {
  const f = setup();
  try {
    const { resolveReview } = await import("../src/server/challenges");
    const { reviewMessage } = await import("../lib/challenge-message");
    const admin = Keypair.generate();
    const challenge = await f.post(f.creator), s = await f.submit(Keypair.generate(), challenge.id);
    await f.decision(f.creator, s.id, "approve");
    f.store.repo.challenges.moveSubmission(s.id, "approved", { status: "review", payoutSignature: "sigX", error: "unclear" });
    const resolve = (pair: Keypair, resolution: "paid" | "retry") => {
      const r = { wallet: pair.publicKey.toBase58(), mint: f.mint, issuedAt: now, nonce: nonce(), submissionId: s.id, resolution };
      return resolveReview(f.store.repo, verify, f.coin(), [admin.publicKey.toBase58()], r, sign(pair, reviewMessage(r)), now);
    };
    await expect(resolve(f.creator, "paid")).rejects.toThrow("admin");
    expect(await resolve(admin, "retry")).toBe(true);
    expect(f.store.repo.challenges.submission(s.id)?.status).toBe("approved");
    await expect(resolve(admin, "paid")).rejects.toThrow("not waiting for review");
  } finally { f.store.close(); }
});
