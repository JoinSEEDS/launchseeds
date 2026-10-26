import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolardSource } from "../src/server/solard";
import type { TraderClient } from "../src/server/solard-sdk";

test("rewards use the installed SDK trading preset, including signer and durable claims", async () => {
  const dir = mkdtempSync(join(tmpdir(), "launchseeds-rewards-runtime-"));
  const previous = process.env.SOLARD_DB_PATH;
  process.env.SOLARD_DB_PATH = join(dir, "sdk.sqlite");
  let source: SolardSource | undefined;
  try {
    // Unreachable RPC: this capability check must perform no network operation.
    source = await SolardSource.createTrader("http://127.0.0.1:1");
    const trader = source.sdk as unknown as TraderClient;
    expect(typeof trader.signer).toBe("function");
    expect(typeof trader.buy).toBe("function");
    expect(typeof trader.claims.creatorFees.claim).toBe("function");
  } finally {
    source?.close();
    if (previous === undefined) delete process.env.SOLARD_DB_PATH;
    else process.env.SOLARD_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
