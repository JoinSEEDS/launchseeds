import { expect, test } from "bun:test";
import { renderToString } from "tradjs/server/ssr";
import { JSDOM } from "jsdom";
import LaunchPage from "../app/launch/page";
test("the launch form is a schedule and launch columns, without retired controls", () => {
  const dom = new JSDOM(renderToString(<LaunchPage />));
  try {
    const d = dom.window.document;
    expect(d.getElementById("f-scheduled-at")?.getAttribute("type")).toBe(
      "datetime-local",
    );
    expect(d.getElementById("user-batch-controls")?.hidden).toBe(false);
    expect(d.getElementById("f-fees-to")).not.toBeNull();
    for (const id of [
      "advanced-settings",
      "sniper-puzzle",
      "launch-liquidity",
      "first-strategy-root",
      "reward-fund",
      "creator-fees",
      "sniper-protection",
      "f-bundle",
      "f-wallet-share-0",
      "f-profit-mode",
      "f-fee-mode",
      "boost-controls",
      "free-launch",
      "mine",
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
