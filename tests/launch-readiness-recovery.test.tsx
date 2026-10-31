import { test, expect } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToString } from "tradjs/server/ssr";
import LaunchPage from "../app/launch/page";
import mount from "../app/launch/page.client";

test("a launch form recovers a failed readiness check without reload or losing entered details", async () => {
  const dom = new JSDOM(renderToString(<LaunchPage />), {
    url: "https://launchseeds.xyz/launch",
    pretendToBeVisual: true,
  });
  const keys = [
    "window",
    "document",
    "location",
    "history",
    "navigator",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLFormElement",
    "Node",
    "Text",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const oldFetch = globalThis.fetch;
  let cleanup: ReturnType<typeof mount>,
    enabled = false,
    transportFails = false,
    checks = 0,
    budget = 1_500_000_000;
  try {
    for (const key of keys)
      Object.defineProperty(globalThis, key, {
        value: (dom.window as any)[key],
        configurable: true,
        writable: true,
      });
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes("launch-config")) {
        checks++;
        if (transportFails) throw new Error("Network interrupted");
        return Response.json({
          launchEnabled: enabled,
          baseFeeLamports: 20000000,
          message: "",
          sniperBundles: true,
          protectionBudget: {
            maxLamports: budget,
            checkedAt: Date.now(),
            fresh: true,
          },
        });
      }
      return Response.json({ packs: [], stocks: [] });
    }) as unknown as typeof fetch;
    cleanup = mount();
    await Bun.sleep(30);
    const button = dom.window.document.getElementById(
      "recheck-launch",
    ) as HTMLButtonElement;
    const name = dom.window.document.getElementById(
      "f-name",
    ) as HTMLInputElement;
    name.value = "Keep these details";
    expect(button.hidden).toBe(false);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(
      true,
    );
    enabled = true;
    button.click();
    await Bun.sleep(20);
    expect(button.hidden).toBe(true);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(
      false,
    );
    expect(name.value).toBe("Keep these details");
    expect(
      (dom.window.document.getElementById("f-bundle") as HTMLInputElement).max,
    ).toBe("3");
    transportFails = true;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(20);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(
      false,
    );
    expect(
      dom.window.document.getElementById("launch-ready-hint")!.hidden,
    ).toBe(true);
    expect(name.value).toBe("Keep these details");
    transportFails = false;
    budget = 0;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(20);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(
      false,
    );
    expect(
      (
        dom.window.document.querySelector(
          "#sniper-protection [data-switch]",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      dom.window.document.getElementById("bundle-capacity")!.textContent,
    ).toContain("Checking automatically");
    enabled = false;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(20);
    expect(button.hidden).toBe(false);
    expect(dom.window.document.getElementById("submit-wrap")!.hidden).toBe(
      true,
    );
    cleanup?.();
    cleanup = undefined;
    const before = checks;
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    await Bun.sleep(5);
    expect(checks).toBe(before);
  } finally {
    cleanup?.();
    dom.window.close();
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value) Object.defineProperty(globalThis, key, value);
      else delete (globalThis as any)[key];
    }
  }
});

// Browser submission sends the actual schedule and allocation without fetching legacy catalogues.
for (const feeMode of ["holders", "creator"] as const) test(`scheduled form submits time, allocation and profit wallet with ${feeMode} fees`, async () => {
  const dom = new JSDOM(renderToString(<LaunchPage />), {
    url: "https://launchseeds.xyz/launch",
    pretendToBeVisual: true,
  });
  const keys = [
    "window",
    "document",
    "location",
    "history",
    "navigator",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLFormElement",
    "Node",
    "Text",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const oldFetch = globalThis.fetch;
  let cleanup: ReturnType<typeof mount>,
    payload: any,
    catalogCalls = 0;
  try {
    for (const key of keys)
      Object.defineProperty(globalThis, key, {
        value: (dom.window as any)[key],
        configurable: true,
        writable: true,
      });
    globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/catalog")) {
        catalogCalls++;
        throw new Error("Retired catalogue request");
      }
      if (path.includes("launch-config"))
        return Response.json({
          launchEnabled: true,
          baseFeeLamports: 20000000,
          sniperBundles: true,
          protectionBudget: {
            maxLamports: 1000000000,
            checkedAt: Date.now(),
            fresh: true,
          },
        });
      if (path.endsWith("/api/media"))
        return Response.json({
          image: "/api/media/" + "a".repeat(64) + ".png",
        });
      if (path.endsWith("/api/launches") && options?.method === "POST") {
        payload = JSON.parse(String(options.body));
        return Response.json({
          handle: "f".repeat(32),
          status: "funding",
          name: payload.name,
          symbol: payload.symbol,
          fundingWallet: "1".repeat(32),
          requiredLamports: 35000000,
          receivedLamports: 0,
          mint: "So11111111111111111111111111111111111111112",
          launchSignature: "",
          error: "",
          settings: payload.settings,
        });
      }
      throw new Error("Unexpected request " + path);
    }) as unknown as typeof fetch;
    cleanup = mount();
    await Bun.sleep(20);
    const d = dom.window.document,
      get = (id: string) => d.getElementById(id) as HTMLInputElement;
    get("f-name").value = "Scheduled";
    get("f-ticker").value = "TIME";
    get("f-profit-mode").value = "wallet";
    get("f-profit-wallet").value = "1".repeat(32);
    get("f-fee-mode").value = feeMode;
    get("f-fees-to").value = feeMode === "creator" ? "1".repeat(32) : "";
    for (const [i, value] of ["50", "30", "20"].entries())
      get(`f-wallet-share-${i}`).value = value;
    Object.defineProperty(get("f-image"), "files", {
      value: [
        new File([new Uint8Array([1, 2, 3])], "image.png", {
          type: "image/png",
        }),
      ],
      configurable: true,
    });
    d.getElementById("launch-form")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await Bun.sleep(40);
    expect(payload).toBeDefined();
    expect(d.getElementById("reserved-ca-value")!.textContent).toBe("So11111111111111111111111111111111111111112");
    expect((d.getElementById("reserved-ca-preview") as HTMLElement).hidden).toBe(false);
    expect(payload.firstStrategy).toBeNull();
    expect(payload.devBuySol).toBe("0");
    expect(payload.settings.walletSharesBps).toEqual([5000, 3000, 2000]);
    expect(payload.settings.profitPolicy).toEqual({
      mode: "wallet",
      wallet: "1".repeat(32),
    });
    expect(payload.settings.scheduledAt).toBeGreaterThan(Date.now() + 120000);
    expect(payload.settings.bundleMaxHoldMs).toBeNull();
    expect(payload.settings.publishMint).toBe(true);
    expect(payload.settings.holderRewards).toBe(feeMode === "holders");
    expect(payload.settings.feesTo).toBe(feeMode === "creator" ? "1".repeat(32) : null);
    expect(catalogCalls).toBe(0);
  } finally {
    cleanup?.();
    dom.window.close();
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const old = previous.get(key);
      if (old) Object.defineProperty(globalThis, key, old);
      else delete (globalThis as any)[key];
    }
  }
});
