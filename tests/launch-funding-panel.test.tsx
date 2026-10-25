import { test, expect } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToString } from "tradjs/server/ssr";
import LaunchPage from "../app/launch/page";
import mount from "../app/launch/page.client";

test("funding panel copies exact values, watches deposits, and marks completed steps", async () => {
  // An old `?uid=` creator link (pre-2026-10-25 handle) must still resolve.
  const uid = "550e8400-e29b-41d4-a716-446655440000";
  const dom = new JSDOM(renderToString(<LaunchPage />), { url: `https://launchseeds.xyz/launch?uid=${uid}` });
  const keys = ["window", "document", "location", "history", "navigator", "Element", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Node"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldFetch = globalThis.fetch;
  const copies: string[] = [];
  let cleanup: ReturnType<typeof mount>;
  let phase = "funding";
  try {
    for (const key of keys) Object.defineProperty(globalThis, key, {value: (dom.window as any)[key], configurable:true, writable:true});
    Object.defineProperty(dom.window.navigator, "clipboard", {value:{writeText:async (text:string)=>{copies.push(text);}}});
    globalThis.fetch = (async () => Response.json({handle:uid,status:phase,name:"Test",symbol:"TEST",fundingWallet:"1".repeat(32),requiredLamports:520000001,receivedLamports:0,mint:phase==="live"?"1".repeat(32):"",launchSignature:"",error:phase==="failed"?"Launch failed":""})) as unknown as typeof fetch;
    cleanup = mount();
    await new Promise(resolve => setTimeout(resolve, 30));
    const get = (id:string) => dom.window.document.getElementById(id)!;
    expect(get("retry-launch-status").hidden).toBe(true);
    expect(get("payment-status").textContent).toBe("0 SOL received so far.");
    // Moving bar and spinner while waiting; first checklist step says so too.
    expect(get("launch-busy").hidden).toBe(false);
    expect(get("launch-busy-text").textContent).toBe("Waiting for payment");
    expect(get("launch-scan").hidden).toBe(false);
    expect(get("step-payment").textContent).toBe("Waiting for payment");
    expect(get("pay-title").textContent).toBe("Pay to launch");
    expect(get("step-details").querySelector("span")!.textContent).toBe("✓");
    expect(get("back-to-form").getAttribute("href")).toBe("/");
    expect(get("funding-details").querySelector(".qr-box #payment-qr")).not.toBeNull();
    expect(get("funding-details").querySelector(".pay__info #payment-address")).not.toBeNull();
    expect(get("payment-amount").textContent).toBe("0.520000001 SOL");
    get("copy-address").click(); get("copy-amount").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(copies).toEqual(["1".repeat(32), "0.520000001"]);
    expect(get("reward-fund-amount").textContent).toBe("0 SOL");
    expect(get("dev-buy-step").textContent).toContain("Reward fund added to treasury");
    // No reward fund was chosen, so its step is not shown.
    expect(get("dev-buy-step").hidden).toBe(true);
    phase="failed";
    get("retry-launch-status").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(get("retry-launch-status").hidden).toBe(false);
    expect(get("funding-details").hidden).toBe(true);
    phase="live";
    get("retry-launch-status").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(get("retry-launch-status").hidden).toBe(true);
    expect(get("step-deposit").querySelector("span")!.textContent).toBe("✓");
    // Every visible step ticked, ending on the "$TEST is live" card.
    for (const id of ["step-payment", "step-token", "step-treasury", "step-strategy"])
      expect(get(id).classList.contains("is-done")).toBe(true);
    expect(get("launch-busy").hidden).toBe(true);
    expect(get("launch-live").hidden).toBe(false);
    expect(get("launch-live").textContent).toContain("$TEST is live");
    expect(get("launched-token-link").getAttribute("href")).toBe(`/token/${"1".repeat(32)}`);
    expect(get("share-on-x").getAttribute("href")).toContain("https://x.com/intent/post?text=");
  } finally {
    cleanup?.(); dom.window.close(); globalThis.fetch=oldFetch;
    for(const key of keys){const value=previous.get(key);if(value)Object.defineProperty(globalThis,key,value);else delete (globalThis as any)[key];}
  }
});

