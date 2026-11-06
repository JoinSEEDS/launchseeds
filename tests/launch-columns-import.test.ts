import { describe, expect, test } from "bun:test";
import { columnsExport, parseColumnsImport, simpleFromImport } from "../lib/launch-columns";

describe("launch columns import", () => {
  test("CSV: rows per wallet, first row is the signer, first sell rule wins", () => {
    const { columns, proceedsWallet } = parseColumnsImport(
      "column,sol,sell\n1,0.2,profit 2.5\n1,0.1,time 9\n2,0.15,30m\n3,0.05,immediate\nproceeds,Fnj9eDlbGQLseU6O2YfvrGRcHR48He34Hy\n",
    );
    expect(columns.map((c) => c.slots)).toEqual([["0.2", "0.1"], ["0.15"], ["0.05"]]);
    expect(columns[0]).toMatchObject({ exit: "profit", profit: "2.5" });
    expect(columns[1]).toMatchObject({ exit: "time", minutes: "30" });
    expect(columns[2]!.exit).toBe("immediate");
    expect(proceedsWallet).toBe("Fnj9eDlbGQLseU6O2YfvrGRcHR48He34Hy");
  });

  test("JSON round-trips through Export JSON", () => {
    const text = '{"proceedsWallet":"abc","columns":[{"slots":[0.2,0.1],"sell":"profit 2"},{"slots":[0.3],"sell":"time 45"}]}';
    const parsed = parseColumnsImport(text);
    expect(parseColumnsImport(columnsExport(parsed.columns, "abc"))).toEqual(parsed);
    expect(parseColumnsImport("[[0.1],[0.2,0.05]]").columns.map((c) => c.slots)).toEqual([["0.1"], ["0.2", "0.05"]]);
  });

  test("rejects bad input with a readable reason", () => {
    expect(() => parseColumnsImport("1,abc")).toThrow("not an amount");
    expect(() => parseColumnsImport("1,0.1\n3,0.1")).toThrow("none skipped");
    expect(() => parseColumnsImport("5,0.1")).toThrow("column must be 1–4");
    expect(() => parseColumnsImport("1,0.1\n1,0.1\n1,0.1\n1,0.1\n1,0.1")).toThrow("at most 4 wallets");
    expect(() => parseColumnsImport("1,0.1,sometimes")).toThrow("sell rule");
    expect(() => parseColumnsImport('{"columns":[{"slots":[]}]}')).toThrow("slots");
  });

  test("tranches: CSV rows t1.., trigger and sell rule; JSON round trip", () => {
    const { columns, tranches } = parseColumnsImport(
      "column,sol,sell\n1,0.2,profit 2\nt1,0.1,after 10s,profit 10\nt1,0.05\nt2,0.2,mcap below 20k within 2h,time 60\nt3,0.1,mcap 1.5m\n",
    );
    expect(columns).toHaveLength(1);
    expect(tranches.map((t) => t.slots)).toEqual([["0.1", "0.05"], ["0.2"], ["0.1"]]);
    expect(tranches[0]).toMatchObject({ trigger: "delay", seconds: "10", exit: "profit", profit: "10" });
    expect(tranches[1]).toMatchObject({ trigger: "below", usd: "20000", within: "120", exit: "time", minutes: "60" });
    expect(tranches[2]).toMatchObject({ trigger: "above", usd: "1500000" });
    const again = parseColumnsImport(columnsExport(columns, "abc", tranches));
    expect(again.tranches).toEqual(tranches);
    expect(() => parseColumnsImport("1,0.1\nt2,0.1")).toThrow("none skipped");
    expect(() => parseColumnsImport("1,0.1\nt1,0.1,someday")).toThrow("trigger");
  });
});
test("an import that fits simple mode stays simple; any other needs advanced", () => {
  const one = parseColumnsImport(JSON.stringify({ columns: [{ slots: [1.25, 1.25, 1.25, 1.25], sell: "floor 5000" }] }));
  expect(simpleFromImport(one.columns, one.tranches)).toMatchObject({ wallets: "4", sol: "1.25", floor: "5000", trancheWallets: "0" });
  const tranche = parseColumnsImport(JSON.stringify({ columns: [{ slots: [0.5], sell: "floor 5000" }], tranches: [{ slots: [0.2, 0.2], trigger: "after 30s", sell: "ladder 6000" }] }));
  expect(simpleFromImport(tranche.columns, tranche.tranches)).toMatchObject({ trancheWallets: "2", trancheSol: "0.2", seconds: "30", trancheFloor: "6000" });
  for (const file of [
    { columns: [{ slots: [0.7], sell: "floor 5000" }, { slots: [0.7], sell: "floor 5000" }] },
    { columns: [{ slots: [1, 2], sell: "floor 5000" }] },
    { columns: [{ slots: [1], sell: "profit 2" }] },
    { columns: [{ slots: [1], sell: "floor 5000" }], tranches: [{ slots: [0.2], trigger: "mcap above 9000", sell: "ladder 6000" }] },
  ]) {
    const parsed = parseColumnsImport(JSON.stringify(file));
    expect(simpleFromImport(parsed.columns, parsed.tranches)).toBeNull();
  }
});
