import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { mountChallenges } from "../lib/challenges-mount";
import { submissionMessage } from "../lib/challenge-message";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";

test("the challenge board shows the fund, and a submission is signed with the asked amount", async () => {
  const mint = Keypair.generate().publicKey.toBase58(), signer = Keypair.generate(), wallet = signer.publicKey.toBase58();
  const dom = new JSDOM(`<main id="challenges-root" data-mint="${mint}"><span data-stat="available"></span><div data-slot="tasks"></div><div data-slot="side"></div></main>`, { url: "https://launchseeds.xyz/coin/x", pretendToBeVisual: true });
  const keys = ["window", "document", "navigator", "Event", "CustomEvent", "HTMLElement", "HTMLInputElement", "Node"];
  const previous = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const oldFetch = globalThis.fetch;
  const view = {
    creatorWallet: Keypair.generate().publicKey.toBase58(), admins: [],
    balance: { earned: "500000000", paid: "0", promised: "100000000", available: "400000000" },
    challenges: [{ id: 7, title: "Post a video", description: "On X", status: "open", createdAt: 1, minRewardLamports: "10000000", maxRewardLamports: "50000000", maxWinners: 2, winners: 0,
      submissions: [{ id: 1, wallet: Keypair.generate().publicKey.toBase58(), proofUrl: "https://x.com/1", note: "Did it", status: "paid", createdAt: 2, requestedLamports: "40000000", awardedLamports: "30000000", payoutSignature: "5ig" }] }],
  };
  let posted: any;
  try {
    for (const k of keys) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
    (dom.window as any).phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => wallet } }), signMessage: async (b: Uint8Array) => ({ signature: ed25519.sign(b, signer.secretKey.slice(0, 32)) }) } };
    globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
      if (options?.method === "POST") { posted = JSON.parse(String(options.body)); return Response.json(view); }
      return Response.json(view);
    }) as typeof fetch;
    const stop = mountChallenges();
    await Bun.sleep(20);
    const root = dom.window.document.getElementById("challenges-root")!;
    expect(root.textContent).toContain("Post a video");
    expect(root.querySelector('[data-stat="available"]')!.textContent).toBe("0.40");
    // Asked and paid are both shown, under the Paid tab.
    [...root.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Paid"))!.click();
    expect(root.textContent).toContain("Asked 0.04 SOL");
    expect(root.textContent).toContain("Paid 0.03 SOL");
    expect(root.textContent).toContain("0.01 below ask");
    expect(root.querySelector('a[href="https://solscan.io/tx/5ig"]')).not.toBeNull();
    const proof = root.querySelector('input[type="url"]') as HTMLInputElement;
    const ask = root.querySelector('input[type="range"]') as HTMLInputElement;
    proof.value = "https://x.com/me/status/9";
    proof.dispatchEvent(new dom.window.Event("input"));
    ask.value = "20000000";
    ask.dispatchEvent(new dom.window.Event("input"));
    expect(root.querySelector("output")!.textContent).toBe("0.02 SOL");
    (root.querySelector("textarea") as HTMLTextAreaElement).value = "Posted it";
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Submit for review")!.click();
    await Bun.sleep(40);
    expect(posted).toMatchObject({ wallet, mint, challengeId: 7, proofUrl: "https://x.com/me/status/9", requestedLamports: "20000000", note: "Posted it" });
    expect(await ed25519VoteVerifier.verify({ wallet, signature: posted.signature, message: submissionMessage(posted) })).toBe(true);
    stop();
  } finally {
    dom.window.close();
    globalThis.fetch = oldFetch;
    for (const k of keys) { const v = previous.get(k); if (v) Object.defineProperty(globalThis, k, v); else delete (globalThis as any)[k]; }
  }
});
