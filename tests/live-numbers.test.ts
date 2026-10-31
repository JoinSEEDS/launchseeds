import { expect, test } from "bun:test";
import { formatLike, parseNumber } from "../lib/live-numbers";

test("parses money, percentages and unit suffixes", () => {
  expect(parseNumber("$1,234.50")).toMatchObject({
    value: 1234.5,
    prefix: "$",
    decimals: 2,
    grouped: true,
  });
  expect(parseNumber("42.1%")).toMatchObject({ value: 42.1, suffix: "%" });
  expect(parseNumber("$950K")!.scaled).toBeLessThan(
    parseNumber("$1.0M")!.scaled,
  );
  expect(parseNumber("—")).toBeNull();
});

test("formats intermediate values like the target", () => {
  expect(formatLike(parseNumber("$1,234.50")!, 1000)).toBe("$1,000.00");
  expect(formatLike(parseNumber("12 voters")!, 7.6)).toBe("8 voters");
});

test("a live change counts once to the final text without re-triggering itself", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<body><b data-num id="n">$10.00</b></body>`, {
    pretendToBeVisual: true,
  });
  const w = dom.window as any;
  const keys = [
    "document",
    "MutationObserver",
    "Text",
    "Element",
    "HTMLElement",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Document",
  ];
  const saved = keys.map((k) => [k, (globalThis as any)[k]] as const);
  for (const k of keys)
    (globalThis as any)[k] =
      typeof w[k] === "function" && k.endsWith("Frame") ? w[k].bind(w) : w[k];
  const realNow = Date.now;
  try {
    const { watchLiveNumbers } = await import("../lib/live-numbers");
    const stop = watchLiveNumbers(w.document);
    Date.now = () => realNow() + 10_000; // past the page-load quiet period
    const el = w.document.getElementById("n");
    let flashes = 0;
    new w.MutationObserver(() => {
      if (el.classList.contains("num-up") || el.classList.contains("num-down"))
        flashes++;
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
    el.firstChild.nodeValue = "$20.00";
    await new Promise((r) => setTimeout(r, 1200));
    expect(el.textContent).toBe("$20.00");
    expect(el.classList.contains("num-down")).toBe(false);
    expect(flashes).toBeLessThanOrEqual(2); // one flash (remove+add), never flip-flopping
    stop();
  } finally {
    Date.now = realNow;
    for (const [k, v] of saved) (globalThis as any)[k] = v;
    dom.window.close();
  }
});
