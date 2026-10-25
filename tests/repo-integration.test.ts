import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as Fixture } from "bun:sqlite";
import { openLaunchseedsData } from "../src/db";
import { Store, humanToRaw } from "../src/server/store";
import { LaunchService, type LaunchProvider } from "../src/server/launch";
import { indexedWalletPositions } from "../src/server/wallet-positions";
import { insertToken, WALLET } from "./fixtures";
const MINT = "2".repeat(43) + "M";

const path = () =>
  join(mkdtempSync(join(tmpdir(), "launchseeds-repo-")), "test.sqlite");
function initial(store: Store, tokenId: number) {
  const strategy = store.repo.strategies.getOrCreate({
    tokenId,
    type: "burn",
    configKey: '{"type":"burn","amountUsdCents":2500}',
    configJson: '{"type":"burn","amountUsdCents":2500}',
    enabled: true,
    createdAt: Date.now(),
  });
  store.repo.operations.saveState({
    tokenId,
    initialStrategyId: strategy.id,
    switchedAt: Date.now(),
  });
}
test("launch preparation, finalized deposits and signed deployment intent survive retries and reopen", async () => {
  const file = path();
  let store = new Store(openLaunchseedsData(file));
  let preparations = 0,
    deployed: string[] = [];
  const provider: LaunchProvider = {
    createMint: () => ({ mintSignerRef: `launchseeds-mint-${MINT}`, mint: MINT }),
    async prepare({ tokenId }) {
      preparations++;
      return {
        fundingWallet: WALLET,
        fundingWalletName: `launchseeds-${MINT}`,
        mintSignerRef: `launchseeds-mint-${MINT}`,
        rewardWallet: WALLET,
        metadataUri: `https://example.org/${tokenId}`,
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
      return { intent: "persisted-signed-bytes", mintSignerRef: `launchseeds-mint-${MINT}` };
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
  const result = await launch.create(input, "a".repeat(64), (tokenId) =>
    initial(store, tokenId),
  );
  const tokenId = store.repo.tokens.getByHandle(result.handle)!.id;
  expect(result.status).toBe("funding");
  await launch.create(input, "a".repeat(64));
  expect(preparations).toBe(1);
  expect(() => launch.status(result.handle, "b".repeat(64))).toThrow();
  // The CA stays private until the token is live.
  expect(result.mint).toBe("");
  await expect(
    launch.create({ ...input, name: "Changed" }, "a".repeat(64)),
  ).rejects.toThrow("another request");
  await launch.process(tokenId);
  expect(launch.publicStatus(result.handle).status).toBe("deploying");
  expect(store.repo.deposits.listByToken(tokenId)).toHaveLength(1);
  expect(store.repo.deposits.listByToken(tokenId)[0]!.confirmedSlot).toBe(
    42,
  );
  store.close();
  store = new Store(openLaunchseedsData(file));
  launch = new LaunchService(store, provider);
  await launch.process(tokenId);
  expect(launch.publicStatus(result.handle).status).toBe("live");
  expect(deployed).toEqual([
    "persisted-signed-bytes",
    "persisted-signed-bytes",
  ]);
  const publicData = store.publicToken(tokenId);
  expect(publicData).not.toHaveProperty("accessHash");
  expect(publicData).not.toHaveProperty("launchIntent");
  expect(publicData).not.toHaveProperty("creatorWallet");
  store.close();
});

test("failed provider preparation retains idempotency without publishing a fabricated wallet", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  let failing = true;
  const provider = {
    createMint: () => ({ mintSignerRef: `launchseeds-mint-${MINT}`, mint: MINT }),
    async prepare() {
      if (failing) throw new Error("provider timeout");
      return {
        fundingWallet: WALLET,
        fundingWalletName: `launchseeds-${MINT}`,
        mintSignerRef: `launchseeds-mint-${MINT}`,
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
    service.create(input, key, (tokenId) => initial(store, tokenId)),
  ).rejects.toThrow("provider timeout");
  // The launch row exists from creation, but no funding wallet is published.
  const request = store.repo.tokens.preparing()[0]!;
  expect(service.publicStatus(request.handle)).toMatchObject({
    status: "preparing",
    fundingWallet: "",
  });
  expect(store.repo.tokens.get(request.id)!.fundingWallet).toBeNull();
  failing = false;
  const result = await service.create(input, key);
  expect(result.handle).toBe(request.handle);
  expect(result.status).toBe("funding");
  store.close();
});

test("holder snapshots and Gravity use canonical UID links and exact atomic quantities", async () => {
  const file = path();
  let store = new Store(openLaunchseedsData(file));
  const token = insertToken(store, { mint: WALLET });
  initial(store, token.id);
  const now = Date.now();
  const snapshot = {
    holders: [{ wallet: WALLET, balance: 100, balanceUi: "100.000001" }],
    slot: 1,
    observedAt: now,
    complete: true,
  };
  expect(await store.applySnapshot(token.id, snapshot, 0.5, now)).toBe(true);
  const before = store.repo.holders.get(token.id, WALLET)!;
  expect(before.balanceRaw).toBe("100000001");
  expect(before.gravityMicros).toBe("50000000");
  expect(await store.applySnapshot(token.id, snapshot, 0.5, now)).toBe(false);
  await expect(
    store.applySnapshot(
      token.id,
      { ...snapshot, holders: [...snapshot.holders, ...snapshot.holders] },
      0.5,
      now,
    ),
  ).rejects.toThrow("Duplicate");
  expect(store.repo.holders.get(token.id, WALLET)!.gravityMicros).toBe(
    before.gravityMicros,
  );
  store.close();
  store = new Store(openLaunchseedsData(file));
  const listing = indexedWalletPositions(store, {
    address: WALLET,
    page: 1,
    limit: 10,
  });
  expect(listing.positions[0]!.tokenId).toBe(token.id);
  expect(listing.pagination.total).toBe(1);
  await store.applySnapshot(
    token.id,
    { holders: [], slot: 2, observedAt: now + 60_000, complete: true },
    0.5,
    now + 60_000,
  );
  expect(store.repo.holders.get(token.id, WALLET)!.gravityMicros).toBe(
    before.gravityMicros,
  );
  expect(store.leaderboard(token.id).holders).toHaveLength(0);
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
