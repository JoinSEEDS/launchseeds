import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as Fixture } from "bun:sqlite";
import { openLaunchseedsData } from "../src/db";
import { Store, humanToRaw } from "../src/server/store";
import { LaunchService, type LaunchProvider } from "../src/server/launch";
import { indexedWalletPositions } from "../src/server/wallet-positions";
import { tokenFixture, WALLET } from "./fixtures";

const path = () =>
  join(mkdtempSync(join(tmpdir(), "launchseeds-repo-")), "test.sqlite");
function initial(store: Store, uid: string) {
  const strategy = store.repo.strategies.getOrCreate({
    uid: crypto.randomUUID(),
    tokenId: uid,
    type: "burn",
    configKey: '{"type":"burn","amountUsdCents":2500}',
    configJson: '{"type":"burn","amountUsdCents":2500}',
    enabled: true,
    createdAt: Date.now(),
  });
  store.repo.operations.saveState({
    uid: crypto.randomUUID(),
    tokenId: uid,
    initialStrategyId: strategy.uid,
    switchedAt: Date.now(),
  });
}
test("launch preparation, finalized deposits and signed deployment intent survive retries and reopen", async () => {
  const file = path();
  let store = new Store(openLaunchseedsData(file));
  let preparations = 0,
    deployed: string[] = [];
  const provider: LaunchProvider = {
    async prepare({ uid }) {
      preparations++;
      return {
        fundingWallet: WALLET,
        rewardWallet: WALLET,
        metadataUri: `https://example.org/${uid}`,
        requiredLamports: 20_000_000,
      };
    },
    async deposits() {
      return [
        {
          signature: "funding-proof",
          lamports: 20_000_000,
          confirmedSlot: 42,
          confirmedAt: Date.now(),
        },
      ];
    },
    async prepareDeployment() {
      return { intent: "persisted-signed-bytes" };
    },
    async executeDeployment(intent) {
      deployed.push(intent);
      return {
        status: deployed.length === 1 ? "pending" : "confirmed",
        signature: "deployment-proof",
        mint: WALLET,
      };
    },
  };
  const input = {
    name: "Test",
    symbol: "TEST",
    image: "https://example.org/image.png",
    devBuySol: "0",
  };
  let launch = new LaunchService(store, provider);
  const result = await launch.create(input, "a".repeat(64), (uid) =>
    initial(store, uid),
  );
  expect(result.status).toBe("funding");
  await launch.create(input, "a".repeat(64));
  expect(preparations).toBe(1);
  expect(() => launch.status(result.uid, "b".repeat(64))).toThrow();
  await expect(
    launch.create({ ...input, name: "Changed" }, "a".repeat(64)),
  ).rejects.toThrow("another request");
  await launch.process(result.uid);
  expect(launch.publicStatus(result.uid).status).toBe("deploying");
  expect(store.repo.deposits.listByToken(result.uid)).toHaveLength(1);
  expect(store.repo.deposits.listByToken(result.uid)[0]!.confirmedSlot).toBe(
    42,
  );
  store.close();
  store = new Store(openLaunchseedsData(file));
  launch = new LaunchService(store, provider);
  await launch.process(result.uid);
  expect(launch.publicStatus(result.uid).status).toBe("live");
  expect(deployed).toEqual([
    "persisted-signed-bytes",
    "persisted-signed-bytes",
  ]);
  const publicData = store.publicToken(result.uid);
  expect(publicData).not.toHaveProperty("accessHash");
  expect(publicData).not.toHaveProperty("launchIntent");
  expect(publicData).not.toHaveProperty("creatorWallet");
  store.close();
});

test("failed provider preparation retains idempotency without publishing a fabricated wallet", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  let failing = true;
  const provider = {
    async prepare() {
      if (failing) throw new Error("provider timeout");
      return {
        fundingWallet: WALLET,
        rewardWallet: WALLET,
        metadataUri: "https://example.org/meta",
        requiredLamports: 20_000_000,
      };
    },
    async deposits() {
      return [];
    },
    async prepareDeployment() {
      throw new Error("not used");
    },
    async executeDeployment() {
      throw new Error("not used");
    },
  } satisfies LaunchProvider;
  const service = new LaunchService(store, provider),
    key = "c".repeat(64),
    input = {
      name: "Test",
      symbol: "TEST",
      image: "https://example.org/image.png",
    };
  await expect(
    service.create(input, key, (uid) => initial(store, uid)),
  ).rejects.toThrow("provider timeout");
  const request = store.repo.operations.pendingLaunches()[0]!;
  expect(service.publicStatus(request.uid)).toMatchObject({
    status: "preparing",
    fundingWallet: "",
  });
  expect(store.repo.tokens.get(request.uid)).toBeNull();
  failing = false;
  const result = await service.create(input, key);
  expect(result.uid).toBe(request.uid);
  expect(result.status).toBe("funding");
  store.close();
});

test("holder snapshots and Gravity use canonical UID links and exact atomic quantities", () => {
  const file = path();
  let store = new Store(openLaunchseedsData(file));
  const token = tokenFixture();
  store.repo.tokens.insert(token);
  initial(store, token.uid);
  const now = Date.now();
  const snapshot = {
    holders: [{ wallet: WALLET, balance: 100, balanceUi: "100.000001" }],
    slot: 1,
    observedAt: now,
    complete: true,
  };
  expect(store.applySnapshot(token.uid, snapshot, 0.5, now)).toBe(true);
  const before = store.repo.holders.get(token.uid, WALLET)!;
  expect(before.balanceRaw).toBe("100000001");
  expect(before.gravityMicros).toBe("50000000");
  expect(store.applySnapshot(token.uid, snapshot, 0.5, now)).toBe(false);
  expect(() =>
    store.applySnapshot(
      token.uid,
      { ...snapshot, holders: [...snapshot.holders, ...snapshot.holders] },
      0.5,
      now,
    ),
  ).toThrow("Duplicate");
  expect(store.repo.holders.get(token.uid, WALLET)!.gravityMicros).toBe(
    before.gravityMicros,
  );
  store.close();
  store = new Store(openLaunchseedsData(file));
  const listing = indexedWalletPositions(store, {
    address: WALLET,
    page: 1,
    limit: 10,
  });
  expect(listing.positions[0]!.uid).toBe(token.uid);
  expect(listing.pagination.total).toBe(1);
  store.applySnapshot(
    token.uid,
    { holders: [], slot: 2, observedAt: now + 60_000, complete: true },
    0.5,
    now + 60_000,
  );
  expect(store.repo.holders.get(token.uid, WALLET)!.gravityMicros).toBe(
    before.gravityMicros,
  );
  expect(store.leaderboard(token.uid).holders).toHaveLength(0);
  expect(
    indexedWalletPositions(store, { address: WALLET, page: 1, limit: 10 })
      .pagination.total,
  ).toBe(0);
  store.close();
  expect(humanToRaw("9007199254740993.000001", 6)).toBe(
    "9007199254740993000001",
  );
  expect(() => humanToRaw("1.0000001", 6)).toThrow();
});

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
  const token = tokenFixture();
  store.repo.tokens.insert(token);
  const d = {
    uid: crypto.randomUUID(),
    tokenId: token.uid,
    signature: "same",
    lamports: "12",
    confirmedSlot: 1,
    confirmedAt: 1,
    refundSignature: null,
  };
  store.repo.deposits.record(d);
  expect(() =>
    store.repo.tx((tx) => {
      tx.tokens.update(token.uid, { fundingReceivedLamports: "99" });
      tx.deposits.record({ ...d, lamports: "13" });
    }),
  ).toThrow();
  expect(store.repo.tokens.get(token.uid)!.fundingReceivedLamports).toBe("0");
  expect(() =>
    store.repo.tokens.update(token.uid, { fundingReceivedLamports: "-1" }),
  ).toThrow();
  expect(() =>
    store.repo.tx(async (tx) => {
      tx.tokens.update(token.uid, { fundingReceivedLamports: "1" });
    }),
  ).toThrow("synchronous");
  expect(store.repo.tokens.get(token.uid)!.fundingReceivedLamports).toBe("0");
  store.close();
});
