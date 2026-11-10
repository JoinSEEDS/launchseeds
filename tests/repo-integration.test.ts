import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as Fixture } from "bun:sqlite";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { LaunchService, type LaunchProvider } from "../src/server/launch";
import { insertToken, WALLET } from "./fixtures";
const MINT = "2".repeat(43) + "M";

const path = () =>
  join(mkdtempSync(join(tmpdir(), "launchseeds-repo-")), "test.sqlite");



test("legacy database cannot be implicitly rebuilt and duplicate financial receipts rollback", () => {
  const file = path();
  const legacy = new Fixture(file);
  legacy.exec(
    "CREATE TABLE tokens(id INTEGER PRIMARY KEY, uid TEXT, symbol TEXT); INSERT INTO tokens VALUES(1,'legacy','OLD')",
  );
  legacy.close();
  const before = readFileSync(file);
  expect(() => openLaunchseedsData(file)).toThrow(
    "Incompatible LaunchSeeds database schema",
  );
  expect(readFileSync(file)).toEqual(before);
  const store = new Store(openLaunchseedsData(":memory:"));
  const token = insertToken(store);
  const d = {
    tokenId: token.id,
    signature: "same",
    lamports: "12",
    confirmedSlot: 1,
    confirmedAt: 1,
    refundSignature: null,
  };
  store.repo.deposits.record(d);
  expect(() =>
    store.repo.tx((tx) => {
      tx.tokens.update(token.id, { fundingReceivedLamports: "99" });
      tx.deposits.record({ ...d, lamports: "13" });
    }),
  ).toThrow();
  expect(store.repo.tokens.get(token.id)!.fundingReceivedLamports).toBe("0");
  expect(() =>
    store.repo.tokens.update(token.id, { fundingReceivedLamports: "-1" }),
  ).toThrow();
  expect(() =>
    store.repo.tx(async (tx) => {
      tx.tokens.update(token.id, { fundingReceivedLamports: "1" });
    }),
  ).toThrow("synchronous");
  expect(store.repo.tokens.get(token.id)!.fundingReceivedLamports).toBe("0");
  store.close();
});
