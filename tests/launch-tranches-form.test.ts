import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { mountLaunchColumns } from "../lib/launch-columns";

const HTML = `<section id="controls"><div id="launch-columns"></div><div id="launch-tranches" hidden></div>
  <button id="add-column"></button><button id="add-tranche"></button><button id="columns-import"></button><button id="columns-export"></button>
  <input type="file" id="columns-import-file" /><p id="columns-import-status" hidden></p><input id="f-proceeds-wallet" /></section>`;

test("the form adds a tranche, reads it into settings with its funding, and restores it", () => {
  const dom = new JSDOM(HTML);
  const previous = { document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  Object.assign(globalThis, { document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  try {
    const doc = dom.window.document;
    const form = mountLaunchColumns(doc.getElementById("controls")!, () => {});
    (doc.getElementById("f-proceeds-wallet") as HTMLInputElement).value = "3".repeat(32);
    expect(form.read(10_000).value?.tranches).toBeUndefined();
    doc.getElementById("add-tranche")!.click();
    const tranches = doc.getElementById("launch-tranches")!;
    expect(tranches.hidden).toBe(false);
    const trigger = tranches.querySelector<HTMLSelectElement>('select[aria-label="Tranche 1 trigger"]')!;
    trigger.value = "above";
    trigger.dispatchEvent(new dom.window.Event("change"));
    const mcap = tranches.querySelector<HTMLInputElement>('input[aria-label="Tranche 1 market cap in USD"]')!;
    mcap.value = "75000";
    mcap.dispatchEvent(new dom.window.Event("input"));
    const read = form.read(10_000);
    expect(read.error).toBeNull();
    expect(read.value!.tranches).toEqual([{ slots: [100_000_000], trigger: { kind: "mcap", usd: 75_000, direction: "above", withinSeconds: 86_400 }, exit: { kind: "profit", profitBps: 1000 }, slippageBps: 500 }]);
    // Four default columns of 0.1 + their reserves + tip, then the tranche's buy, reserve, fee budget and rent buffer.
    expect(read.fundedLamports).toBe(400_000_000 + 4 * 14_000_000 + 100_000 + 100_000_000 + 14_000_000 + 100_000 + 1_000_000);
    expect(read.totalLamports).toBe(400_000_000);
    expect(form.summary().at(-1)).toEqual(["Tranche 1", "1 wallet · 0.1 SOL · buys when mcap reaches $75,000 · sells at +10% net"]);
    const again = mountLaunchColumns(doc.getElementById("controls")!.cloneNode(true) as HTMLElement, () => {});
    again.restore(read.value!, 10_000);
    expect(again.read(10_000).value).toEqual(read.value);
  } finally {
    Object.assign(globalThis, previous);
  }
});
