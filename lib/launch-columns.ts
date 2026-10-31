/** Launch form: the user-funded launch's columns (one buy transaction each in
 * the Jito bundle). Slot 1 of a column is its LaunchSeeds signing wallet; the
 * launcher adds fresh wallets and sets every slot's buy. Plain DOM. */
import { MAX_COLUMNS, MAX_SLOTS_PER_COLUMN, MIN_BATCH_WALLET_BUY, UserBatchesSchema, type UserBatches } from "../src/domain/user-funded-batches";

type Exit = "profit" | "time" | "immediate";
export type ColumnState = { slots: string[]; exit: Exit; profit: string; minutes: string };
const newColumn = (): ColumnState => ({ slots: ["0.1"], exit: "profit", profit: "2", minutes: "30" });

/** A sell rule as written in an import: "profit 2" / "2%", "time 30" / "30m",
 * "immediate" / "now". */
function parseSell(text: string, column: ColumnState, where: string) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  if (/^(immediate|now|instant)$/.test(t)) { column.exit = "immediate"; return; }
  let m = /^(?:profit|p)\s*[:= ]?\s*\+?(\d+(?:\.\d+)?)\s*%?$/.exec(t) ?? /^\+?(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) { column.exit = "profit"; column.profit = m[1]!; return; }
  m = /^(?:time|t|after)\s*[:= ]?\s*(\d+)\s*(?:m|min|minutes?)?$/.exec(t) ?? /^(\d+)\s*(?:m|min|minutes?)$/.exec(t);
  if (m) { column.exit = "time"; column.minutes = m[1]!; return; }
  throw new Error(`${where}: sell rule "${text}": use "profit 2", "time 30" or "immediate".`);
}

/** Columns from an import file. JSON: {"proceedsWallet"?, "columns": [{"slots":
 * [0.1, 0.05] (SOL; the first is the LaunchSeeds signer), "sell"?: "profit 2"}]},
 * or a bare array of columns. CSV: one row per wallet, `column,sol[,sell]`
 * (header optional); a column's first row is its signer, and its sell rule is
 * the first one given. A `proceeds,<address>` row sets the proceeds wallet. */
export function parseColumnsImport(text: string): { columns: ColumnState[]; proceedsWallet: string | null } {
  const sol = (v: unknown, where: string) => {
    const s = String(v ?? "").trim();
    if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new Error(`${where}: "${s}" is not an amount in SOL.`);
    return s;
  };
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  let columns: ColumnState[] = [];
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
  } else {
    const byIndex = new Map<number, { column: ColumnState; sellSet: boolean }>();
    trimmed.split(/\r?\n/).forEach((line, i) => {
      const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (!cells.some(Boolean) || line.trim().startsWith("#")) return;
      if (/^proceeds/i.test(cells[0]!)) { proceedsWallet = cells[1] ?? ""; return; }
      if (i === 0 && !/^\d/.test(cells[0]!)) return; // header
      const where = `Line ${i + 1}`;
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
  }
  if (columns.length === 0) throw new Error("No columns found.");
  if (columns.length > MAX_COLUMNS) throw new Error(`At most ${MAX_COLUMNS} columns.`);
  columns.forEach((c, i) => { if (c.slots.length > MAX_SLOTS_PER_COLUMN) throw new Error(`Column ${i + 1}: at most ${MAX_SLOTS_PER_COLUMN} wallets.`); });
  return { columns, proceedsWallet };
}

/** The columns as an import file (JSON), so a setup can be saved and reused. */
export function columnsExport(columns: ColumnState[], proceedsWallet: string) {
  return JSON.stringify({
    proceedsWallet: proceedsWallet || undefined,
    columns: columns.map((c) => ({
      slots: c.slots.map(Number),
      sell: c.exit === "profit" ? `profit ${c.profit}` : c.exit === "time" ? `time ${c.minutes}` : "immediate",
    })),
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
  const proceeds = root.querySelector<HTMLInputElement>("#f-proceeds-wallet")!;
  const grid = root.querySelector<HTMLElement>("#launch-columns")!;
  const addColumn = root.querySelector<HTMLButtonElement>("#add-column")!;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function render() {
    grid.replaceChildren(...columns.map((column, c) => {
      const card = el("fieldset", { class: "launch-column" });
      const head = el("legend", { class: "launch-column__head" });
      head.append(el("b", {}, `Column ${c + 1}`), el("span", { class: "launch-column__tx" }, `transaction ${c + 2} of ${columns.length + 1}`));
      card.append(head);
      column.slots.forEach((value, s) => {
        const row = el("div", { class: "launch-slot" });
        const label = el("span", { class: "launch-slot__who" }, s === 0 ? "LaunchSeeds signer" : `Fresh wallet ${s}`);
        if (s === 0) label.title = "One of LaunchSeeds's signing wallets (ace, art, …): it signs and pays this column's transactions. Its exact address is published with the plan.";
        const input = el("input", { class: "input launch-slot__sol", inputmode: "decimal", value, "aria-label": `Column ${c + 1} ${s === 0 ? "signer" : `wallet ${s}`} buy in SOL` }) as HTMLInputElement;
        input.addEventListener("input", () => { column.slots[s] = input.value; onChange(); });
        row.append(label, input, el("span", { class: "launch-slot__unit" }, "SOL"));
        if (s > 0) {
          const remove = el("button", { class: "icon-btn", type: "button", "aria-label": `Remove fresh wallet ${s}` }, "✕");
          remove.addEventListener("click", () => { column.slots.splice(s, 1); render(); onChange(); });
          row.append(remove);
        }
        card.append(row);
      });
      if (column.slots.length < MAX_SLOTS_PER_COLUMN) {
        const add = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "+ Add fresh wallet");
        add.addEventListener("click", () => { column.slots.push("0.1"); render(); onChange(); });
        card.append(add);
      }
      const exit = el("select", { class: "input", "aria-label": `Column ${c + 1} sell rule` }) as HTMLSelectElement;
      for (const [v, t] of [["profit", "Sell at net profit"], ["time", "Sell after a time"], ["immediate", "Sell once buys confirm"]] as const)
        exit.append(Object.assign(el("option", { value: v }, t), { selected: column.exit === v }));
      exit.addEventListener("change", () => { column.exit = exit.value as Exit; render(); onChange(); });
      const rule = el("label", { class: "field" });
      rule.append(el("span", { class: "label label--sm" }, "Sells"), exit);
      card.append(rule);
      if (column.exit !== "immediate") {
        const isProfit = column.exit === "profit";
        const input = el("input", { class: "input", type: "number", min: isProfit ? "0.01" : "1", step: isProfit ? "0.01" : "1", value: isProfit ? column.profit : column.minutes,
          "aria-label": isProfit ? `Column ${c + 1} profit target percent` : `Column ${c + 1} minutes after launch` }) as HTMLInputElement;
        input.addEventListener("input", () => { if (isProfit) column.profit = input.value; else column.minutes = input.value; onChange(); });
        const field = el("label", { class: "field" });
        field.append(el("span", { class: "label label--sm" }, isProfit ? "Profit target (%), after costs" : "Minutes after launch"), input);
        card.append(field);
      }
      if (c > 0 && c === columns.length - 1) {
        const remove = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, "Remove column");
        remove.addEventListener("click", () => { columns.pop(); render(); onChange(); });
        card.append(remove);
      }
      return card;
    }));
    addColumn.hidden = columns.length >= MAX_COLUMNS;
  }
  addColumn.addEventListener("click", () => { if (columns.length < MAX_COLUMNS) columns.push(newColumn()); render(); onChange(); });
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
      if (imported.proceedsWallet !== null) proceeds.value = imported.proceedsWallet;
      render(); onChange();
      const wallets = columns.reduce((n, c) => n + c.slots.length, 0);
      say(`Imported ${columns.length} column${columns.length > 1 ? "s" : ""}, ${wallets} wallet${wallets > 1 ? "s" : ""} from ${file.name}.`);
    } catch (error) {
      say(error instanceof SyntaxError ? "That JSON could not be read." : error instanceof Error ? error.message : "That file could not be imported.", true);
    }
  });
  root.querySelector<HTMLButtonElement>("#columns-export")!.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([columnsExport(columns, proceeds.value.trim())], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "launch-columns.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();

  return {
    /** The columns as launch settings, or why they are not valid yet. */
    read(scheduledAt: number): { value: UserBatches | null; error: string | null; totalLamports: number; wallets: number } {
      let error: string | null = null;
      const parsed = columns.map((column, c) => {
        const slots = column.slots.map((v) => solToLamports(v));
        if (slots.some((s) => s === null)) error ??= `Column ${c + 1}: enter each wallet's buy in SOL.`;
        else if (slots.some((s) => BigInt(s!) < MIN_BATCH_WALLET_BUY)) error ??= `Column ${c + 1}: every wallet buys at least ${Number(MIN_BATCH_WALLET_BUY) / 1e9} SOL.`;
        const profitBps = Math.round(Number(column.profit) * 100), minutes = Number(column.minutes);
        const exit = column.exit === "profit" ? { kind: "profit" as const, profitBps }
          : column.exit === "time" ? { kind: "time" as const, at: scheduledAt + minutes * 60_000 } : { kind: "immediate" as const };
        if (column.exit === "profit" && !(profitBps >= 1 && profitBps <= 100_000)) error ??= `Column ${c + 1}: choose a profit target from 0.01% to 1000%.`;
        if (column.exit === "time" && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 43_200)) error ??= `Column ${c + 1}: choose 1–43200 minutes after launch.`;
        return { slots: slots.map((s) => s ?? 0), exit };
      });
      const totalLamports = parsed.reduce((sum, c) => sum + c.slots.reduce((a, b) => a + b, 0), 0);
      const wallets = parsed.reduce((sum, c) => sum + c.slots.length, 0);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proceeds.value.trim())) error ??= "Enter the wallet that receives every column's proceeds.";
      const result = UserBatchesSchema.safeParse({ columns: parsed, proceedsWallet: proceeds.value.trim() });
      if (!result.success) error ??= result.error.issues[0]?.message ?? "Check the columns.";
      return { value: error || !result.success ? null : result.data, error, totalLamports, wallets };
    },
    /** Fills the controls from a saved launch (editing before payment). */
    restore(saved: UserBatches, scheduledAt: number) {
      columns = saved.columns.map((column) => ({
        slots: column.slots.map(lamportsToSol),
        exit: column.exit.kind,
        profit: column.exit.kind === "profit" ? String(column.exit.profitBps / 100) : "2",
        minutes: column.exit.kind === "time" ? String(Math.round((column.exit.at - scheduledAt) / 60_000)) : "30",
      }));
      proceeds.value = saved.proceedsWallet;
      render();
    },
    /** Summary lines: one per column. */
    summary(): Array<[string, string]> {
      return columns.map((column, c) => [
        `Column ${c + 1}`,
        `${column.slots.length} wallet${column.slots.length > 1 ? "s" : ""} · ${column.slots.reduce((s, v) => s + (Number(v) || 0), 0)} SOL · ${
          column.exit === "profit" ? `sells at +${column.profit}% net` : column.exit === "time" ? `sells ${column.minutes} min after launch` : "sells once buys confirm"}`,
      ]);
    },
  };
}
