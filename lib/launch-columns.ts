/** Launch form: the user-funded launch's columns (one buy transaction each in
 * the Jito bundle) and its tranches (one plain buy transaction each, after the
 * launch). Slot 1 of a column is its LaunchSeeds signing wallet; the launcher adds
 * fresh wallets and sets every slot's buy. Plain DOM. */
import { BUNDLE_MIN_LAMPORTS } from "../src/domain/launch-settings";
import { MAX_COLUMNS, MAX_SLOTS_PER_COLUMN, MAX_TRANCHES, MAX_TRANCHE_WALLETS, MIN_BATCH_WALLET_BUY, UserBatchesSchema, startingMcapSol, trancheFunding, type Tranche, type UserBatches } from "../src/domain/user-funded-batches";

/** Mirrors BUYER_RESERVE_LAMPORTS / JITO_TIP_LAMPORTS (src/server/launch-bundle.ts). */
const BUYER_RESERVE = 14_000_000, BUNDLE_TIP = 100_000;

type Exit = "profit" | "time" | "immediate" | "floor" | "ladder";
type Sell = { exit: Exit; profit: string; minutes: string; floorUsd: string };
export type ColumnState = Sell & { slots: string[] };
/** trigger: "delay" fires `seconds` after the launch; "above"/"below" once the
 * USD market cap reaches / falls to `usd`, within `within` minutes. */
export type TrancheState = Sell & { slots: string[]; trigger: "delay" | "above" | "below"; seconds: string; usd: string; within: string };
const newColumn = (): ColumnState => ({ slots: ["0.1"], exit: "profit", profit: "2", minutes: "30", floorUsd: "" });
const newTranche = (): TrancheState => ({ slots: ["0.1"], trigger: "delay", seconds: "10", usd: "50000", within: "1440", exit: "profit", profit: "10", minutes: "30", floorUsd: "" });

/** Simple mode: how many wallets, what each buys, and the market cap each group
 * must leave behind when it sells. */
export type SimpleState = { wallets: string; sol: string; floor: string; trancheWallets: string; trancheSol: string; seconds: string; trancheFloor: string };
const MAX_BUNDLE_WALLETS = MAX_COLUMNS * MAX_SLOTS_PER_COLUMN;
/** Simple mode as ordinary columns and a tranche: wallets fill as few columns as
 * they fit, evenly, so a bundle of up to four sells in a single transaction. */
export function simpleSetup(simple: SimpleState): { columns: ColumnState[]; tranches: TrancheState[] } {
  const wallets = Math.min(MAX_BUNDLE_WALLETS, Math.max(1, Math.floor(Number(simple.wallets)) || 1));
  const count = Math.ceil(wallets / MAX_SLOTS_PER_COLUMN);
  const columns = Array.from({ length: count }, (_, c): ColumnState => ({
    ...newColumn(), exit: "floor", floorUsd: simple.floor,
    slots: Array<string>(Math.floor(wallets / count) + (c < wallets % count ? 1 : 0)).fill(simple.sol),
  }));
  const buyers = Math.min(MAX_TRANCHE_WALLETS, Math.max(0, Math.floor(Number(simple.trancheWallets)) || 0));
  return { columns, tranches: buyers ? [{ ...newTranche(), slots: Array<string>(buyers).fill(simple.trancheSol), seconds: simple.seconds, exit: "ladder", floorUsd: simple.trancheFloor }] : [] };
}

/** A tranche trigger as written in an import: "after 10s" / "10s" / "2m",
 * "mcap 50k" (reaches), "mcap below 20000", optionally "within 60m" / "within 2h". */
function parseTrigger(text: string, tranche: TrancheState, where: string) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  let m = /^(?:after|delay|wait)?\s*(\d+)\s*(s|sec|secs|seconds?|m|min|minutes?)?$/.exec(t);
  if (m) { tranche.trigger = "delay"; tranche.seconds = String(Number(m[1]) * (m[2]?.startsWith("m") ? 60 : 1)); return; }
  m = /^(?:mcap|market ?cap)\s*(>=|>|above|reaches|<=|<|below|falls to)?\s*\$?(\d+(?:\.\d+)?)\s*(k|m)?(?:\s+within\s+(\d+)\s*(m|min|minutes?|h|hours?)?)?$/.exec(t);
  if (m) {
    tranche.trigger = m[1] && /<|below|falls/.test(m[1]) ? "below" : "above";
    tranche.usd = String(Number(m[2]) * (m[3] === "k" ? 1e3 : m[3] === "m" ? 1e6 : 1));
    if (m[4]) tranche.within = String(Number(m[4]) * (m[5]?.startsWith("h") ? 60 : 1));
    return;
  }
  throw new Error(`${where}: trigger "${text}": use "after 10s", "mcap 50k" or "mcap below 20k within 60m".`);
}
const triggerText = (t: TrancheState) => t.trigger === "delay" ? `after ${t.seconds}s` : `mcap ${t.trigger === "below" ? "below " : ""}${t.usd} within ${t.within}m`;

/** A sell rule as written in an import: "profit 2" / "2%", "time 30" / "30m",
 * "immediate" / "now", "floor 30k" (all together, keeping that market cap),
 * "ladder 30k" (a tranche's wallets one at a time, keeping that market cap). */
function parseSell(text: string, column: Sell, where: string) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  if (/^(immediate|now|instant)$/.test(t)) { column.exit = "immediate"; return; }
  let m = /^(?:profit|p)\s*[:= ]?\s*\+?(\d+(?:\.\d+)?)\s*%?$/.exec(t) ?? /^\+?(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) { column.exit = "profit"; column.profit = m[1]!; return; }
  m = /^(?:time|t|after)\s*[:= ]?\s*(\d+)\s*(?:m|min|minutes?)?$/.exec(t) ?? /^(\d+)\s*(?:m|min|minutes?)$/.exec(t);
  if (m) { column.exit = "time"; column.minutes = m[1]!; return; }
  m = /^(floor|ladder)\s*[:= ]?\s*\$?(\d+(?:\.\d+)?)\s*(k|m)?$/.exec(t);
  if (m) { column.exit = m[1] as Exit; column.floorUsd = String(Number(m[2]) * (m[3] === "k" ? 1e3 : m[3] === "m" ? 1e6 : 1)); return; }
  throw new Error(`${where}: sell rule "${text}": use "profit 2", "time 30", "floor 30k", "ladder 30k" or "immediate".`);
}

/** Columns from an import file. JSON: {"proceedsWallet"?, "columns": [{"slots":
 * [0.1, 0.05] (SOL; the first is the LaunchSeeds signer), "sell"?: "profit 2"}]},
 * or a bare array of columns. CSV: one row per wallet, `column,sol[,sell]`
 * (header optional); a column's first row is its signer, and its sell rule is
 * the first one given. A `proceeds,<address>` row sets the proceeds wallet. */
export function parseColumnsImport(text: string): { columns: ColumnState[]; tranches: TrancheState[]; proceedsWallet: string | null } {
  const sol = (v: unknown, where: string) => {
    const s = String(v ?? "").trim();
    if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new Error(`${where}: "${s}" is not an amount in SOL.`);
    return s;
  };
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  let columns: ColumnState[] = [];
  let tranches: TrancheState[] = [];
  let proceedsWallet: string | null = null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(data) ? data : (data as { columns?: unknown }).columns;
    if (!Array.isArray(list)) throw new Error('JSON needs a "columns" array.');
    const wallet = Array.isArray(data) ? undefined : (data as { proceedsWallet?: unknown }).proceedsWallet;
    if (typeof wallet === "string") proceedsWallet = wallet.trim();
    columns = list.map((raw, c) => {
      const entry = (Array.isArray(raw) ? { slots: raw } : raw) as { slots?: unknown; sell?: unknown };
      if (!Array.isArray(entry.slots) || entry.slots.length === 0) throw new Error(`Column ${c + 1}: needs "slots", the SOL each wallet buys.`);
      const column = { ...newColumn(), slots: entry.slots.map((v, s) => sol(v, `Column ${c + 1}, wallet ${s + 1}`)) };
      if (entry.sell !== undefined) parseSell(String(entry.sell), column, `Column ${c + 1}`);
      return column;
    });
    const rawTranches = Array.isArray(data) ? [] : (data as { tranches?: unknown }).tranches ?? [];
    if (!Array.isArray(rawTranches)) throw new Error('"tranches" must be an array.');
    tranches = rawTranches.map((raw, i) => {
      const entry = raw as { slots?: unknown; trigger?: unknown; sell?: unknown };
      if (!Array.isArray(entry.slots) || entry.slots.length === 0) throw new Error(`Tranche ${i + 1}: needs "slots", the SOL each wallet buys.`);
      const tranche = { ...newTranche(), slots: entry.slots.map((v, s) => sol(v, `Tranche ${i + 1}, wallet ${s + 1}`)) };
      if (entry.trigger !== undefined) parseTrigger(String(entry.trigger), tranche, `Tranche ${i + 1}`);
      if (entry.sell !== undefined) parseSell(String(entry.sell), tranche, `Tranche ${i + 1}`);
      return tranche;
    });
  } else {
    const byIndex = new Map<number, { column: ColumnState; sellSet: boolean }>();
    const byTranche = new Map<number, { tranche: TrancheState; triggerSet: boolean; sellSet: boolean }>();
    trimmed.split(/\r?\n/).forEach((line, i) => {
      const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (!cells.some(Boolean) || line.trim().startsWith("#")) return;
      if (/^proceeds/i.test(cells[0]!)) { proceedsWallet = cells[1] ?? ""; return; }
      const where = `Line ${i + 1}`;
      // A tranche row: `t1,sol,trigger,sell` (its first trigger and sell rule win).
      const t = /^t(?:ranche)?\s*(\d+)$/i.exec(cells[0]!);
      if (t) {
        const index = Number(t[1]);
        if (index < 1 || index > MAX_TRANCHES) throw new Error(`${where}: tranche must be t1–t${MAX_TRANCHES}.`);
        const amount = sol(cells[1], where);
        let entry = byTranche.get(index);
        if (!entry) byTranche.set(index, (entry = { tranche: { ...newTranche(), slots: [amount] }, triggerSet: false, sellSet: false }));
        else entry.tranche.slots.push(amount);
        if (cells[2] && !entry.triggerSet) { parseTrigger(cells[2], entry.tranche, where); entry.triggerSet = true; }
        if (cells[3] && !entry.sellSet) { parseSell(cells[3], entry.tranche, where); entry.sellSet = true; }
        return;
      }
      if (i === 0 && !/^\d/.test(cells[0]!)) return; // header
      const index = Number(cells[0]);
      if (!Number.isInteger(index) || index < 1 || index > MAX_COLUMNS) throw new Error(`${where}: column must be 1–${MAX_COLUMNS}.`);
      const amount = sol(cells[1], where);
      let entry = byIndex.get(index);
      if (!entry) byIndex.set(index, (entry = { column: { ...newColumn(), slots: [amount] }, sellSet: false }));
      else entry.column.slots.push(amount);
      if (cells[2] && !entry.sellSet) { parseSell(cells[2], entry.column, where); entry.sellSet = true; }
    });
    const indexes = [...byIndex.keys()].sort((a, b) => a - b);
    if (indexes.some((n, i) => n !== i + 1)) throw new Error("Columns must be numbered 1, 2, 3… with none skipped.");
    columns = indexes.map((n) => byIndex.get(n)!.column);
    const trancheIndexes = [...byTranche.keys()].sort((a, b) => a - b);
    if (trancheIndexes.some((n, i) => n !== i + 1)) throw new Error("Tranches must be numbered t1, t2, t3… with none skipped.");
    tranches = trancheIndexes.map((n) => byTranche.get(n)!.tranche);
  }
  if (columns.length === 0) throw new Error("No columns found.");
  if (columns.length > MAX_COLUMNS) throw new Error(`At most ${MAX_COLUMNS} columns.`);
  columns.forEach((c, i) => {
    if (c.slots.length > MAX_SLOTS_PER_COLUMN) throw new Error(`Column ${i + 1}: at most ${MAX_SLOTS_PER_COLUMN} wallets.`);
    if (c.exit === "ladder") throw new Error(`Column ${i + 1}: a column sells in one transaction; use "floor", or "ladder" on a tranche.`);
  });
  if (tranches.length > MAX_TRANCHES) throw new Error(`At most ${MAX_TRANCHES} tranches.`);
  tranches.forEach((t, i) => { if (t.slots.length > MAX_TRANCHE_WALLETS) throw new Error(`Tranche ${i + 1}: at most ${MAX_TRANCHE_WALLETS} wallets.`); });
  return { columns, tranches, proceedsWallet };
}

/** The simple form of an imported setup, or null when only advanced mode can
 * show it: its columns and tranche must be exactly what simple mode would build. */
export function simpleFromImport(columns: ColumnState[], tranches: TrancheState[]): SimpleState | null {
  const first = columns[0], tranche = tranches[0];
  if (!first?.slots[0]) return null;
  const simple: SimpleState = {
    wallets: String(columns.reduce((n, c) => n + c.slots.length, 0)), sol: first.slots[0], floor: first.floorUsd,
    trancheWallets: String(tranche?.slots.length ?? 0), trancheSol: tranche?.slots[0] ?? "0.1", seconds: tranche?.seconds ?? "10", trancheFloor: tranche?.floorUsd ?? "",
  };
  const shape = (c: ColumnState[], t: TrancheState[]) => JSON.stringify([c.map((x) => [x.slots, x.exit, x.floorUsd]), t.map((x) => [x.slots, x.exit, x.floorUsd, x.trigger, x.seconds])]);
  const built = simpleSetup(simple);
  return shape(columns, tranches) === shape(built.columns, built.tranches) ? simple : null;
}

/** The columns as an import file (JSON), so a setup can be saved and reused. */
const sellText = (c: Sell) => c.exit === "profit" ? `profit ${c.profit}` : c.exit === "time" ? `time ${c.minutes}` : c.exit === "immediate" ? "immediate" : `${c.exit} ${c.floorUsd}`;
export function columnsExport(columns: ColumnState[], proceedsWallet: string, tranches: TrancheState[] = []) {
  return JSON.stringify({
    proceedsWallet: proceedsWallet || undefined,
    columns: columns.map((c) => ({ slots: c.slots.map(Number), sell: sellText(c) })),
    ...(tranches.length ? { tranches: tranches.map((t) => ({ slots: t.slots.map(Number), trigger: triggerText(t), sell: sellText(t) })) } : {}),
  }, null, 2);
}

const solToLamports = (value: string) => {
  if (!/^\d+(\.\d{1,9})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0")));
};
const lamportsToSol = (lamports: number) => String(lamports / 1e9);

export function mountLaunchColumns(root: HTMLElement, onChange: () => void) {
  let columns: ColumnState[] = [0, 1, 2, 3].map(newColumn);
  let tranches: TrancheState[] = [];
  const proceeds = root.querySelector<HTMLInputElement>("#f-proceeds-wallet")!;
  const grid = root.querySelector<HTMLElement>("#launch-columns")!;
  const addColumn = root.querySelector<HTMLButtonElement>("#add-column")!;
  const trancheGrid = root.querySelector<HTMLElement>("#launch-tranches")!;
  const addTranche = root.querySelector<HTMLButtonElement>("#add-tranche")!;
  const simpleRoot = root.querySelector<HTMLElement>("#launch-simple");
  const modeSimple = root.querySelector<HTMLButtonElement>("#mode-simple");
  const modeAdvanced = root.querySelector<HTMLButtonElement>("#mode-advanced");
  let mode: "simple" | "advanced" = simpleRoot ? "simple" : "advanced";
  let solUsd: number | null = null;
  const simple: SimpleState = { wallets: "4", sol: "0.1", floor: "", trancheWallets: "0", trancheSol: "0.1", seconds: "10", trancheFloor: "" };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const field = (label: string, control: HTMLElement) => {
    const node = el("label", { class: "field" });
    node.append(el("span", { class: "label label--sm" }, label), control);
    return node;
  };
  const numberInput = (value: string, min: string, step: string, aria: string, set: (v: string) => void) => {
    const input = el("input", { class: "input", type: "number", min, step, value, "aria-label": aria }) as HTMLInputElement;
    input.addEventListener("input", () => { set(input.value); onChange(); });
    return input;
  };
  /** A wallet row: its buy in SOL, removable unless it is the first. */
  const slotRow = (slots: string[], s: number, who: string, aria: string, title?: string) => {
    const row = el("div", { class: "launch-slot" });
    const label = el("span", { class: "launch-slot__who" }, who);
    if (title) label.title = title;
    const input = el("input", { class: "input launch-slot__sol", inputmode: "decimal", value: slots[s]!, "aria-label": aria }) as HTMLInputElement;
    input.addEventListener("input", () => { slots[s] = input.value; onChange(); });
    row.append(label, input, el("span", { class: "launch-slot__unit" }, "SOL"));
    if (s > 0) {
      const remove = el("button", { class: "icon-btn", type: "button", "aria-label": `Remove ${who.toLowerCase()}` }, "✕");
      remove.addEventListener("click", () => { slots.splice(s, 1); render(); onChange(); });
      row.append(remove);
    }
    return row;
  };
  const addSlot = (slots: string[], max: number) => {
    if (slots.length >= max) return [];
    const add = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "+ Add fresh wallet");
    add.addEventListener("click", () => { slots.push("0.1"); render(); onChange(); });
    return [add];
  };
  /** The sell rule: net profit target, minutes after launch, or at once. */
  const sellControls = (state: Sell, name: string, ladder = false) => {
    const exit = el("select", { class: "input", "aria-label": `${name} sell rule` }) as HTMLSelectElement;
    const rules: Array<[Exit, string]> = [["floor", "Sell all, keeping a market cap"], ...(ladder ? [["ladder", "Sell one by one, keeping a market cap"] as [Exit, string]] : []), ["profit", "Sell at net profit"], ["time", "Sell after a time"], ["immediate", "Sell once buys confirm"]];
    for (const [v, t] of rules)
      exit.append(Object.assign(el("option", { value: v }, t), { selected: state.exit === v }));
    exit.addEventListener("change", () => { state.exit = exit.value as Exit; render(); onChange(); });
    const nodes: HTMLElement[] = [field("Sells", exit)];
    if (state.exit === "profit") nodes.push(field("Profit target (%), after costs", numberInput(state.profit, "0.01", "0.01", `${name} profit target percent`, (v) => { state.profit = v; })));
    if (state.exit === "time") nodes.push(field("Minutes after launch", numberInput(state.minutes, "1", "1", `${name} minutes after launch`, (v) => { state.minutes = v; })));
    if (state.exit === "floor" || state.exit === "ladder") nodes.push(field("Keep market cap above (USD)", numberInput(state.floorUsd, "1", "1000", `${name} market cap floor in USD`, (v) => { state.floorUsd = v; })));
    return nodes;
  };

  /** What the current buys do to the market cap, for choosing the floors. */
  const money = (sol: number) => solUsd ? `$${Math.round(sol * solUsd).toLocaleString("en")}` : `${Math.round(sol)} SOL`;
  const bought = (list: Array<{ slots: string[] }>) => list.reduce((sum, c) => sum + c.slots.reduce((s, v) => s + (solToLamports(v) ?? 0), 0), 0);
  const mcapHint = simpleRoot ? el("p", { class: "setting-help", role: "status" }) : null;
  function paintHint() {
    if (!mcapHint) return;
    const bundle = bought(columns), tranche = bought(tranches);
    mcapHint.textContent = `Starting market cap ≈ ${money(startingMcapSol(bundle))} after the bundle${tranche ? `, ≈ ${money(startingMcapSol(bundle + tranche))} after the tranche` : ""}. An empty coin is ≈ ${money(startingMcapSol(0))}, so that is about where the market cap lands if your wallets sell everything and nobody else has bought.`;
  }
  function syncSimple() {
    ({ columns, tranches } = simpleSetup(simple));
    paintHint();
  }
  function renderSimple() {
    if (!simpleRoot) return;
    const group = (title: string, ...fields: HTMLElement[]) => {
      const card = el("fieldset", { class: "launch-column" });
      const head = el("legend", { class: "launch-column__head" });
      head.append(el("b", {}, title));
      card.append(head, ...fields);
      return card;
    };
    const input = (key: keyof SimpleState, label: string, min: string, step: string) =>
      field(label, numberInput(simple[key], min, step, label, (v) => { simple[key] = v; syncSimple(); }));
    simpleRoot.replaceChildren(
      group("Bundle (first block)", input("wallets", `Wallets (1–${MAX_BUNDLE_WALLETS})`, "1", "1"), input("sol", "SOL each", "0.03", "0.01"),
        input("floor", "Sell all once market cap stays above (USD)", "1", "1000")),
      group("Tranche (after launch, optional)", input("trancheWallets", `Wallets (0–${MAX_TRANCHE_WALLETS})`, "0", "1"), input("trancheSol", "SOL each", "0.03", "0.01"),
        input("seconds", "Buys this many seconds after launch", "1", "1"), input("trancheFloor", "Sell one by one, keeping market cap above (USD)", "1", "1000")),
      mcapHint!,
    );
  }
  function setMode(next: "simple" | "advanced") {
    mode = next;
    if (mode === "simple") { syncSimple(); renderSimple(); }
    render();
  }
  function render() {
    const advanced = mode === "advanced";
    if (simpleRoot) simpleRoot.hidden = advanced;
    grid.hidden = !advanced;
    modeSimple?.classList.toggle("btn--ghost", advanced);
    modeAdvanced?.classList.toggle("btn--ghost", !advanced);
    modeSimple?.setAttribute("aria-pressed", String(!advanced));
    modeAdvanced?.setAttribute("aria-pressed", String(advanced));
    grid.replaceChildren(...columns.map((column, c) => {
      const card = el("fieldset", { class: "launch-column" });
      const head = el("legend", { class: "launch-column__head" });
      head.append(el("b", {}, `Column ${c + 1}`), el("span", { class: "launch-column__tx" }, `transaction ${c + 2} of ${columns.length + 1}`));
      card.append(head);
      column.slots.forEach((_, s) => card.append(slotRow(column.slots, s, s === 0 ? "LaunchSeeds signer" : `Fresh wallet ${s}`,
        `Column ${c + 1} ${s === 0 ? "signer" : `wallet ${s}`} buy in SOL`,
        s === 0 ? "One of LaunchSeeds's signing wallets (ace, art, …): it signs and pays this column's transactions. Its exact address is published with the plan." : undefined)));
      card.append(...addSlot(column.slots, MAX_SLOTS_PER_COLUMN), ...sellControls(column, `Column ${c + 1}`));
      if (c > 0 && c === columns.length - 1) {
        const remove = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Remove column");
        remove.addEventListener("click", () => { columns.pop(); render(); onChange(); });
        card.append(remove);
      }
      return card;
    }));
    addColumn.hidden = !advanced || columns.length >= MAX_COLUMNS;
    trancheGrid.replaceChildren(...tranches.map((tranche, t) => {
      const name = `Tranche ${t + 1}`;
      const card = el("fieldset", { class: "launch-column launch-column--tranche" });
      const head = el("legend", { class: "launch-column__head" });
      head.append(el("b", {}, name), el("span", { class: "launch-column__tx" }, "one transaction after launch"));
      card.append(head);
      const trigger = el("select", { class: "input", "aria-label": `${name} trigger` }) as HTMLSelectElement;
      for (const [v, text] of [["delay", "Seconds after launch"], ["above", "Market cap reaches"], ["below", "Market cap falls to"]] as const)
        trigger.append(Object.assign(el("option", { value: v }, text), { selected: tranche.trigger === v }));
      trigger.addEventListener("change", () => { tranche.trigger = trigger.value as TrancheState["trigger"]; render(); onChange(); });
      card.append(field("Buys when", trigger));
      if (tranche.trigger === "delay") card.append(field("Seconds after launch", numberInput(tranche.seconds, "1", "1", `${name} seconds after launch`, (v) => { tranche.seconds = v; })));
      else card.append(
        field("Market cap (USD)", numberInput(tranche.usd, "1", "1000", `${name} market cap in USD`, (v) => { tranche.usd = v; })),
        field("Skip if not within (minutes)", numberInput(tranche.within, "1", "1", `${name} window in minutes`, (v) => { tranche.within = v; })),
      );
      tranche.slots.forEach((_, s) => card.append(slotRow(tranche.slots, s, `Fresh wallet ${s + 1}`, `${name} wallet ${s + 1} buy in SOL`)));
      card.append(...addSlot(tranche.slots, MAX_TRANCHE_WALLETS), ...sellControls(tranche, name, true));
      const remove = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Remove tranche");
      remove.addEventListener("click", () => { tranches.splice(t, 1); render(); onChange(); });
      card.append(remove);
      return card;
    }));
    trancheGrid.hidden = !advanced || tranches.length === 0;
    addTranche.hidden = !advanced || tranches.length >= MAX_TRANCHES;
  }
  addColumn.addEventListener("click", () => { if (columns.length < MAX_COLUMNS) columns.push(newColumn()); render(); onChange(); });
  addTranche.addEventListener("click", () => { if (tranches.length < MAX_TRANCHES) tranches.push(newTranche()); render(); onChange(); });
  modeSimple?.addEventListener("click", () => { setMode("simple"); onChange(); });
  modeAdvanced?.addEventListener("click", () => { setMode("advanced"); onChange(); });
  proceeds.addEventListener("input", onChange);
  // Import from a CSV or JSON file; export the current setup as JSON.
  const importFile = root.querySelector<HTMLInputElement>("#columns-import-file")!;
  const importStatus = root.querySelector<HTMLElement>("#columns-import-status")!;
  const say = (text: string, error = false) => { importStatus.textContent = text; importStatus.hidden = !text; importStatus.classList.toggle("is-error", error); };
  root.querySelector<HTMLButtonElement>("#columns-import")!.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    try {
      if (file.size > 64_000) throw new Error("That file is too large for a columns import.");
      const imported = parseColumnsImport(await file.text());
      columns = imported.columns;
      tranches = imported.tranches;
      if (imported.proceedsWallet !== null) proceeds.value = imported.proceedsWallet;
      const fit = simpleRoot ? simpleFromImport(columns, tranches) : null;
      if (fit) { Object.assign(simple, fit); setMode("simple"); }
      else { mode = "advanced"; render(); }
      onChange();
      const wallets = [...columns, ...tranches].reduce((n, c) => n + c.slots.length, 0);
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      say(`Imported ${plural(columns.length, "column")}${tranches.length ? `, ${plural(tranches.length, "tranche")}` : ""}, ${plural(wallets, "wallet")} from ${file.name}.`);
    } catch (error) {
      say(error instanceof SyntaxError ? "That JSON could not be read." : error instanceof Error ? error.message : "That file could not be imported.", true);
    }
  });
  root.querySelector<HTMLButtonElement>("#columns-export")!.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([columnsExport(columns, proceeds.value.trim(), tranches)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "launch-columns.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  if (mode === "simple") { syncSimple(); renderSimple(); }
  render();

  const readSell = (state: Sell, name: string, scheduledAt: number, fail: (e: string) => void) => {
    const profitBps = Math.round(Number(state.profit) * 100), minutes = Number(state.minutes);
    if (state.exit === "profit" && !(profitBps >= 1 && profitBps <= 100_000)) fail(`${name}: choose a profit target from 0.01% to 1000%.`);
    if (state.exit === "time" && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 43_200)) fail(`${name}: choose 1–43200 minutes after launch.`);
    if ((state.exit === "floor" || state.exit === "ladder") && !(Number(state.floorUsd) > 0)) fail(`${name}: enter the market cap to keep, in USD.`);
    return state.exit === "profit" ? { kind: "profit" as const, profitBps }
      : state.exit === "time" ? { kind: "time" as const, at: scheduledAt + minutes * 60_000 }
      : state.exit === "floor" || state.exit === "ladder" ? { kind: state.exit, usd: Number(state.floorUsd) } : { kind: "immediate" as const };
  };
  const readSlots = (values: string[], name: string, fail: (e: string) => void) => {
    const slots = values.map((v) => solToLamports(v));
    if (slots.some((s) => s === null)) fail(`${name}: enter each wallet's buy in SOL.`);
    else if (slots.some((s) => BigInt(s!) < MIN_BATCH_WALLET_BUY)) fail(`${name}: every wallet buys at least ${Number(MIN_BATCH_WALLET_BUY) / 1e9} SOL.`);
    return slots.map((s) => s ?? 0);
  };
  const usdText = (value: string) => `$${Number(value).toLocaleString("en")}`;
  const sellSummary = (state: Sell) => state.exit === "profit" ? `sells at +${state.profit}% net` : state.exit === "time" ? `sells ${state.minutes} min after launch`
    : state.exit === "floor" ? `sells all once mcap stays above ${usdText(state.floorUsd)}` : state.exit === "ladder" ? `sells one by one, keeping mcap above ${usdText(state.floorUsd)}` : "sells once buys confirm";
  const triggerSummary = (t: TrancheState) => t.trigger === "delay" ? `buys ${t.seconds}s after launch`
    : `buys when mcap ${t.trigger === "above" ? "reaches" : "falls to"} $${Number(t.usd).toLocaleString("en")}`;
  const sumSol = (slots: string[]) => slots.reduce((s, v) => s + (Number(v) || 0), 0);

  return {
    /** The columns and tranches as launch settings, or why they are not valid
     * yet. `totalLamports` is the launch bundle's buy (columns only). */
    read(scheduledAt: number): { value: UserBatches | null; error: string | null; totalLamports: number; wallets: number; trancheLamports: number; trancheWallets: number; tranches: number; fundedLamports: number } {
      let error: string | null = null;
      const fail = (e: string) => { error ??= e; };
      if (mode === "simple") {
        const wallets = Number(simple.wallets), buyers = Number(simple.trancheWallets);
        if (!(Number.isInteger(wallets) && wallets >= 1 && wallets <= MAX_BUNDLE_WALLETS)) fail(`Choose 1–${MAX_BUNDLE_WALLETS} bundle wallets.`);
        if (!(Number.isInteger(buyers) && buyers >= 0 && buyers <= MAX_TRANCHE_WALLETS)) fail(`Choose 0–${MAX_TRANCHE_WALLETS} tranche wallets.`);
        if (!(Number(simple.floor) > 0)) fail("Enter the market cap the bundle's sale must keep, in USD.");
        if (buyers > 0 && !(Number(simple.trancheFloor) > 0)) fail("Enter the market cap the tranche's sales must keep, in USD.");
      }
      const parsed = columns.map((column, c) => ({ slots: readSlots(column.slots, `Column ${c + 1}`, fail), exit: readSell(column, `Column ${c + 1}`, scheduledAt, fail) }));
      const parsedTranches = tranches.map((t, i) => {
        const name = `Tranche ${i + 1}`;
        const seconds = Number(t.seconds), usd = Number(t.usd), within = Number(t.within);
        if (t.trigger === "delay" && !(Number.isInteger(seconds) && seconds >= 1 && seconds <= 604_800)) fail(`${name}: choose 1–604800 seconds after launch.`);
        if (t.trigger !== "delay" && !(usd > 0)) fail(`${name}: enter the market cap in USD.`);
        if (t.trigger !== "delay" && !(Number.isInteger(within) && within >= 1 && within <= 10_080)) fail(`${name}: choose a window of 1–10080 minutes.`);
        return {
          slots: readSlots(t.slots, name, fail),
          trigger: t.trigger === "delay" ? { kind: "delay" as const, seconds } : { kind: "mcap" as const, usd, direction: t.trigger, withinSeconds: within * 60 },
          exit: readSell(t, name, scheduledAt, fail),
          slippageBps: 500,
        };
      });
      const total = (list: Array<{ slots: number[] }>) => list.reduce((sum, c) => sum + c.slots.reduce((a, b) => a + b, 0), 0);
      const count = (list: Array<{ slots: number[] }>) => list.reduce((sum, c) => sum + c.slots.length, 0);
      if (total(parsed) < BUNDLE_MIN_LAMPORTS) fail(`The bundle buys at least ${BUNDLE_MIN_LAMPORTS / 1e9} SOL in all.`);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proceeds.value.trim())) fail("Enter the wallet that receives every column's proceeds.");
      const result = UserBatchesSchema.safeParse({ columns: parsed, ...(parsedTranches.length ? { tranches: parsedTranches } : {}), proceedsWallet: proceeds.value.trim() });
      if (!result.success) fail(result.error.issues[0]?.message ?? "Check the columns.");
      return { value: error || !result.success ? null : result.data, error, totalLamports: total(parsed), wallets: count(parsed),
        trancheLamports: total(parsedTranches), trancheWallets: count(parsedTranches), tranches: parsedTranches.length,
        // What the launcher sends for these beyond the base fee (as the server quotes it).
        fundedLamports: total(parsed) + count(parsed) * BUYER_RESERVE + BUNDLE_TIP + Number(trancheFunding({ tranches: parsedTranches }, BigInt(BUYER_RESERVE))) };
    },
    /** Fills the controls from a saved launch (editing before payment). */
    restore(saved: UserBatches, scheduledAt: number) {
      const sell = (exit: Tranche["exit"]): Sell => ({
        exit: exit.kind,
        floorUsd: exit.kind === "floor" || exit.kind === "ladder" ? String(exit.usd) : "",
        profit: exit.kind === "profit" ? String(exit.profitBps / 100) : "2",
        minutes: exit.kind === "time" ? String(Math.round((exit.at - scheduledAt) / 60_000)) : "30",
      });
      columns = saved.columns.map((column) => ({ slots: column.slots.map(lamportsToSol), ...sell(column.exit) }));
      tranches = (saved.tranches ?? []).map((t) => ({
        ...newTranche(), slots: t.slots.map(lamportsToSol), ...sell(t.exit),
        ...(t.trigger.kind === "delay" ? { trigger: "delay" as const, seconds: String(t.trigger.seconds) }
          : { trigger: t.trigger.direction, usd: String(t.trigger.usd), within: String(Math.round(t.trigger.withinSeconds / 60)) }),
      }));
      proceeds.value = saved.proceedsWallet;
      mode = "advanced";
      render();
    },
    /** The SOL price behind the market cap estimates (null shows them in SOL). */
    setSolUsd(price: number | null) { solUsd = price; paintHint(); },
    /** Summary lines: one per column, then one per tranche. */
    summary(): Array<[string, string]> {
      return [
        ...columns.map((column, c): [string, string] => [`Column ${c + 1}`,
          `${column.slots.length} wallet${column.slots.length > 1 ? "s" : ""} · ${sumSol(column.slots)} SOL · ${sellSummary(column)}`]),
        ...tranches.map((t, i): [string, string] => [`Tranche ${i + 1}`,
          `${t.slots.length} wallet${t.slots.length > 1 ? "s" : ""} · ${sumSol(t.slots)} SOL · ${triggerSummary(t)} · ${sellSummary(t)}`]),
      ];
    },
  };
}
