import { expect, test, describe } from "bun:test";
import { renderToString } from "tradjs/server/ssr";
import { JSDOM } from "jsdom";
import LaunchPage from "../app/launch/page";
import { DESCRIPTION } from "../lib/strategy";

function doc() {
  const dom = new JSDOM(renderToString(<LaunchPage />), { url: "http://localhost:3010/launch" });
  return { dom, d: dom.window.document };
}

describe("immutable launch-policy designer controls", () => {
  test("launch sections render in the specified order", () => {
    const { dom, d } = doc();
    try {
      const form = d.getElementById("launch-form")!;
      const text = form.textContent || "";
      const sections = ["Token", "Default strategy", "Sniper protection", "Concentrated liquidity", "Initial reward fund"];
      const indices = sections.map((name) => text.indexOf(name));
      expect(indices.every((n) => n >= 0)).toBe(true);
      expect(indices).toEqual([...indices].sort((a,b) => a-b));
    } finally { dom.window.close(); }
  });

  test("defaults to no developer-funded purchase and a 0.02 SOL quote", () => {
    const { dom, d } = doc();
    try {
      // The reward fund panel is switched off by default; its amount is ignored.
      const fund = d.querySelector('[data-toggle-panel="fund"]')!;
      expect(fund.classList.contains("is-off")).toBe(true);
      expect(fund.querySelector("[data-switch]")!.getAttribute("aria-checked")).toBe("false");
      expect(d.getElementById("summary-dev")!.textContent?.trim()).toBe("0");
      expect(d.getElementById("summary-total")!.textContent?.trim()).toMatch(/^0\.02/);
      expect(d.getElementById("reward-fund-ticker")?.textContent).toBe("$TOKEN");
    } finally { dom.window.close(); }
  });

  test("retains exact locked description", () => {
    const { dom, d } = doc();
    try {
      const input = d.getElementById("f-desc") as HTMLInputElement;
      expect(input.value).toBe(DESCRIPTION);
      expect(input.readOnly).toBe(true);
    } finally { dom.window.close(); }
  });

  test("strategy, proof-of-work and liquidity controls have requested defaults", () => {
    const { dom, d } = doc();
    try {
      // Strategy rules are fixed defaults, not a form panel.
      expect(d.getElementById("strategy-rules")).toBeNull();
      expect(d.querySelector("[data-rule]")).toBeNull();
      // Sliders: 30s puzzle, 25% of fees, $100K–$1M.
      const stops = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];
      expect(stops[Number((d.querySelector("[data-pow]") as HTMLInputElement).value)]).toBe(30);
      expect((d.querySelector("[data-share]") as HTMLInputElement).value).toBe("25");
      expect(d.querySelector("[data-range-out]")!.textContent).toBe("$100K–$1M");
      for (const panel of ["pow", "liq"])
        expect(d.querySelector(`[data-toggle-panel="${panel}"] [data-switch]`)!.getAttribute("aria-checked")).toBe("true");
    } finally { dom.window.close(); }
  });

  test("confirmation has one clear funding address and an edit button, without a status badge", () => {
    const { dom, d } = doc();
    try {
      expect(d.querySelectorAll("#payment-address")).toHaveLength(1);
      expect(d.getElementById("edit-launch-details")?.textContent).toContain("Edit Details");
      expect(d.getElementById("pay-in-wallet")?.textContent).toContain("Pay in Wallet");
      expect(d.getElementById("payment-expires")).not.toBeNull();
      expect(d.getElementById("launch-status-pill")).toBeNull();
      expect(d.getElementById("reward-fund-amount")).not.toBeNull();
      expect(d.getElementById("funding-details")).not.toBeNull();
    } finally { dom.window.close(); }
  });

  test("the fee split summary describes every dollar without a hidden allocation", () => {
    const { dom, d } = doc();
    try {
      // The legend is drawn by the client; the server sends the stated order.
      const fees = d.getElementById("launch-fee-legend")!.closest(".summary-block")!.textContent || "";
      // Concentrated liquidity is not built: no fee share is promised for it.
      expect(fees).toContain("$TOKEN first; the rest goes to holder rewards.");
      expect(d.getElementById("launch-liquidity")?.hasAttribute("hidden")).toBe(true);
      expect(d.getElementById("launch-fee-split")?.getAttribute("role")).toBe("img");
    } finally { dom.window.close(); }
  });

  test("sniper and liquidity choices never block the launch form", () => {
    const { dom, d } = doc();
    try {
      expect(d.getElementById("sniper-capability-note")).toBeNull();
      expect(d.getElementById("liquidity-capability-note")).toBeNull();
      expect(d.getElementById("sniper-protection")!.textContent).toContain("on a MacBook");
      expect(d.querySelector("[data-fake-buy-progress]")).toBeNull();
    } finally { dom.window.close(); }
  });
});
