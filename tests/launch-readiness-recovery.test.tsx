import { test, expect } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToString } from "tradjs/server/ssr";
import LaunchPage from "../app/launch/page";
import mount from "../app/launch/page.client";

test("a launch form recovers a failed readiness check without reload or losing entered details", async () => {
  const dom = new JSDOM(renderToString(<LaunchPage />), { url: "https://launchseeds.xyz/launch", pretendToBeVisual: true });
  const keys = ["window", "document", "location", "history", "navigator", "Element", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Node"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldFetch = globalThis.fetch;
  let cleanup: ReturnType<typeof mount>, enabled = false, checks = 0;
  try {
    for (const key of keys) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes("launch-config")) { checks++; return Response.json({ launchEnabled: enabled, baseFeeLamports: 20000000, message: "" }); }
      return Response.json({ packs: [], stocks: [] });
    }) as unknown as typeof fetch;
    cleanup = mount();
    await Bun.sleep(30);
    const button = dom.window.document.getElementById("recheck-launch") as HTMLButtonElement;
    const name = dom.window.document.getElementById("f-name") as HTMLInputElement;
    name.value = "Keep these details";
    expect(button.hidden).toBe(false);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(true);
    enabled = true;
    button.click();
    await Bun.sleep(20);
    expect(button.hidden).toBe(true);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(false);
    expect(name.value).toBe("Keep these details");
    enabled = false;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(20);
    expect(button.hidden).toBe(false);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(true);
    cleanup?.(); cleanup = undefined;
    const before = checks;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(5);
    expect(checks).toBe(before);
  } finally {
    cleanup?.(); dom.window.close(); globalThis.fetch = oldFetch;
    for (const key of keys) { const value = previous.get(key); if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as any)[key]; }
  }
});
