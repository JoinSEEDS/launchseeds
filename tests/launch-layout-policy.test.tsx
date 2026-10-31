import { expect, test } from "bun:test";
import { renderToString } from "tradjs/server/ssr";
import { JSDOM } from "jsdom";
import LaunchPage from "../app/launch/page";
test("new launch UI is schedule, allocation and profit policy without retired controls", () => {
  const dom = new JSDOM(renderToString(<LaunchPage />));
  try {
    const d = dom.window.document;
    expect(d.getElementById("f-scheduled-at")?.getAttribute("type")).toBe(
      "datetime-local",
    );
    for (const i of [0, 1, 2])
      expect(d.getElementById(`f-wallet-share-${i}`)).not.toBeNull();
    const shares = [0, 1, 2].map((i) =>
      Number(
        (d.getElementById(`f-wallet-share-${i}`) as HTMLInputElement).value,
      ),
    );
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100)).toBe(10000);
    expect(d.getElementById("f-profit-mode")?.textContent).toContain(
      "Buy this token & burn",
    );
    expect(
      d.querySelector('option[value="cashback"]')?.hasAttribute("disabled"),
    ).toBe(true);
    for (const id of [
      "advanced-settings",
      "sniper-puzzle",
      "launch-liquidity",
      "first-strategy-root",
      "reward-fund",
      "creator-fees",
    ])
      expect(d.getElementById(id)).toBeNull();
    expect(d.querySelectorAll("#payment-address")).toHaveLength(1);
    expect(d.getElementById("edit-launch-details")).not.toBeNull();
    expect(d.getElementById("payment-expires")).not.toBeNull();
    expect(d.getElementById("funded-plan-preview")).not.toBeNull();
  } finally {
    dom.window.close();
  }
});
