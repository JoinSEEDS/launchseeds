import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { advanceQueue, nextSlot, queueKey, queueList, queueState } from "../src/server/launch-queue";
import { decideQueued } from "../src/server/queue-decisions";
import { queueDecisionMessage } from "../lib/queue-message";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";
import { TREASURY_WALLET } from "../src/server/treasury";

const input = (symbol: string) => JSON.stringify({ name: symbol, symbol, description: `About ${symbol}`, image: "", website: "", x: "", telegram: "", devBuySol: "0" });
const MIN = 60_000;

test("each coin gets its own time 20 minutes after the last; it launches then, or at once when an admin says so", async () => {
  process.env.LAUNCHSEEDS_MAX_BUNDLE_SOL = "1";
  delete process.env.LAUNCHSEEDS_QUEUE_GAP_MINUTES;
  const store = new Store(openLaunchseedsData(":memory:"));
  const started: string[] = [];
  const service = { create: async (i: { symbol: string }, _c: string, onCreated: (id: number) => void) => {
    started.push(i.symbol);
    onCreated(insertToken(store, { status: "failed", fundingWalletName: TREASURY_WALLET } as never).id);
  } } as never;
  const provider = { walletFor: () => ({ address: Keypair.generate().publicKey.toBase58() }), balanceLamports: async () => 2_000_000_000 };
  const admin = Keypair.generate(), wallet = admin.publicKey.toBase58(), other = Keypair.generate();
  const t0 = 1_000_000_000_000;
  const add = (symbol: string, now: number) => {
    const capability = symbol.padEnd(64, "0").replace(/[^a-f0-9]/g, "a").slice(0, 64);
    store.repo.launchQueue.add({ key: queueKey(capability), capability, wallet: Keypair.generate().publicKey.toBase58(), inputJson: input(symbol), now, scheduledFor: nextSlot(store, now) });
    return queueKey(capability);
  };
  const verify = ed25519VoteVerifier.verify.bind(ed25519VoteVerifier);
  const decide = (key: string, decision: "approve" | "reject", signer = admin, now = Date.now()) => {
    const r = { wallet: signer.publicKey.toBase58(), key, decision, issuedAt: now, nonce: Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32) };
    const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(queueDecisionMessage(r)), signer.secretKey.slice(0, 32)));
    return decideQueued(store.repo, verify, [wallet], r, signature, now);
  };
  try {
    const a = add("aaa", t0), b = add("bbb", t0 + MIN), c = add("ccc", t0 + 2 * MIN);
    // Slots never overlap: 20, 40 and 60 minutes after the first request.
    expect(queueList(store, t0).waiting.map((w) => (w.scheduledFor - t0) / MIN)).toEqual([20, 40, 60]);
    expect(queueList(store, t0).waiting[0]!.description).toBe("About aaa");
    expect(queueState(store, b, t0)).toMatchObject({ status: "waiting", position: 2, etaSeconds: 40 * 60 });
    await advanceQueue(store, service, provider, () => t0 + 19 * MIN);
    expect(started).toEqual([]);
    await advanceQueue(store, service, provider, () => t0 + 20 * MIN);
    expect(started).toEqual(["aaa"]);
    // An admin launches the third now; the second keeps its own time.
    await expect(decide(c, "approve", other)).rejects.toThrow("admin");
    await decide(c, "approve", admin, t0 + 21 * MIN);
    await advanceQueue(store, service, provider, () => t0 + 21 * MIN);
    expect(started).toEqual(["aaa", "ccc"]);
    expect(queueState(store, b, t0 + 21 * MIN)).toMatchObject({ position: 1 });
    await decide(b, "reject");
    expect(queueState(store, b)).toMatchObject({ status: "failed", error: "Removed from the queue." });
    expect(queueState(store, a)!.status).toBe("started");
    // The next newcomer comes 20 minutes after the latest time given out.
    expect((nextSlot(store, t0 + 22 * MIN) - t0) / MIN).toBe(80);
  } finally { store.close(); }
});
