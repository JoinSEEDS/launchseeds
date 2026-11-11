import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToString } from "tradjs/server/ssr";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import LaunchPage from "../app/launch/page";
import mount from "../app/launch/page.client";
import { seedMessage } from "../lib/seed-message";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";

test("the free launch form signs with the creator's wallet and posts the coin", async () => {
  const dom = new JSDOM(renderToString(<LaunchPage />), { url: "https://launchseeds.xyz/launch", pretendToBeVisual: true });
  const keys = ["window", "document", "location", "navigator", "Event", "CustomEvent", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Node", "Text", "File", "URL"];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldFetch = globalThis.fetch;
  const signer = Keypair.generate(), wallet = signer.publicKey.toBase58();
  let payload: any, assigned = "";
  try {
    for (const key of keys) if (key !== "File" && key !== "URL") Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
    (dom.window as any).URL.createObjectURL = () => "blob:preview";
    (dom.window as any).URL.revokeObjectURL = () => {};
    (dom.window as any).phantom = { solana: {
      isPhantom: true,
      connect: async () => ({ publicKey: { toString: () => wallet } }),
      signMessage: async (bytes: Uint8Array) => ({ signature: ed25519.sign(bytes, signer.secretKey.slice(0, 32)) }),
    } };
    Object.defineProperty(globalThis, "location", { value: { href: dom.window.location.href, assign: (to: string) => { assigned = to; } }, configurable: true, writable: true });
    globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
      const path = String(url);
      if (path.includes("launch-config")) return Response.json({ launchEnabled: true, seedBundleLamports: 1_500_000_000 });
      if (path.endsWith("/api/media")) return Response.json({ image: "/api/media/" + "a".repeat(64) + ".png" });
      if (path.endsWith("/api/seeds")) { payload = JSON.parse(String(options!.body)); return Response.json({ key: "a".repeat(32), status: "waiting", position: 2, ahead: 1, approved: false, etaSeconds: null }); }
      throw new Error("Unexpected request " + path);
    }) as typeof fetch;
    const cleanup = mount();
    await Bun.sleep(20);
    const d = dom.window.document, get = (id: string) => d.getElementById(id) as HTMLInputElement;
    expect(get("seed-bundle").textContent).toContain("1.50 SOL");
    get("f-name").value = "Seed Coin";
    get("f-ticker").value = "seed";
    get("f-desc").value = "Grows";
    Object.defineProperty(get("f-image"), "files", { value: [new File([new Uint8Array([137, 80, 78, 71])], "i.png", { type: "image/png" })], configurable: true });
    get("f-image").dispatchEvent(new dom.window.Event("change"));
    d.getElementById("seed-form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await Bun.sleep(60);
    expect(payload).toMatchObject({ wallet, name: "Seed Coin", symbol: "SEED", description: "Grows", image: "/api/media/" + "a".repeat(64) + ".png" });
    expect(payload.nonce).toMatch(/^[a-f0-9]{32}$/);
    // The signature covers every field: a changed description no longer verifies.
    expect(await ed25519VoteVerifier.verify({ wallet, signature: payload.signature, message: seedMessage({ ...payload, description: "Other" }) })).toBe(false);
    expect(await ed25519VoteVerifier.verify({ wallet, signature: payload.signature, message: seedMessage(payload) })).toBe(true);
    expect(bs58.decode(payload.signature)).toHaveLength(64);
    // Queued: the launcher goes to the queue with their coin picked out.
    expect(assigned).toBe("/queue?mine=" + "a".repeat(32));
    cleanup?.();
  } finally {
    dom.window.close();
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value) Object.defineProperty(globalThis, key, value);
      else delete (globalThis as any)[key];
    }
  }
});
