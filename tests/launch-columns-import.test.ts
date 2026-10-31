import { describe, expect, test } from "bun:test";
import { columnsExport, parseColumnsImport } from "../lib/launch-columns";

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
});
