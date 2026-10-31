import { createLaunchseedsCoreServices } from "../src/services";
import {
  refreshProtectionBudget,
  assertProtectionBudget,
  protectionBudget,
} from "../src/server/protection-budget";
import { Database, z } from "sqlite-zod-orm";
import { schemas } from "../src/db/schema";
import { storedLaunchSettings } from "../src/domain/launch-settings";
import { tokenFixture } from "./fixtures";
import { createHash } from "node:crypto";
import { insertToken } from "./fixtures";
import { test, expect, spyOn } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import {
  LaunchService,
  validateSchedule,
  type LaunchProvider,
} from "../src/server/launch";
import {
  type LaunchSettings,
  DEFAULT_LAUNCH_SETTINGS,
  parseLaunchSettings,
} from "../src/domain/launch-settings";
import { allocatedBudget } from "../src/domain/protection-allocation";
import {
  publicScheduledPlan,
  scheduledLaunches,
} from "../src/server/scheduled-launches";
import { pendingCapital } from "../src/server/capital-reservations";
import { renderHomePage } from "../app/page";
import { renderToString } from "tradjs/server/ssr";
const address = () => Keypair.generate().publicKey.toBase58();
const input = {
  name: "Scheduled Coin",
  symbol: "CLOCK",
  description: "Public plan",
  image: "/api/media/" + "a".repeat(64) + ".png",
  website: "",
  x: "",
  telegram: "",
  devBuySol: "0",
};
function fixture(path = ":memory:", overrides: Partial<LaunchSettings> = {}) {
  let clock = Date.now(),
    due = clock + 600000;
  const time = spyOn(Date, "now").mockImplementation(() => clock);
  let store = new Store(openLaunchseedsData(path));
  const mint = address(),
    funding = address(),
    wallets = [address(), address(), address()];
  const settings = parseLaunchSettings({
    ...DEFAULT_LAUNCH_SETTINGS,
    holderRewards: true,
    sniperSeconds: null,
    bundleLamports: 500000000,
    scheduledAt: due,
    walletSharesBps: [5000, 3000, 2000],
    profitPolicy: { mode: "burn" },
    bundleExitPercent: 110,
    ...overrides,
  });
  const calls = { prepare: 0, execute: 0, confirmed: false, late: false };
  const provider: LaunchProvider = {
    createMint: () => ({ mint, mintSignerRef: `launchseeds-mint-${mint}` }),
    planBuyers: (_ref, budgets) =>
      budgets.map((n, i) => ({
        name: `buyer-${i}`,
        wallet: wallets[i]!,
        budgetLamports: n.toString(),
      })),
    prepare: async () => ({
      fundingWallet: funding,
      rewardWallet: funding,
      fundingWalletName: "test",
      mintSignerRef: `launchseeds-mint-${mint}`,
      metadataUri: "ipfs://test",
      requiredLamports: 20000000,
    }),
    deposits: async () => [
      {
        signature: "deposit",
        lamports: 35000000,
        confirmedAt: calls.late ? due + 1 : due - 300000,
        confirmedSlot: 1,
      },
    ],
    prepareDeployment: async () => {
      calls.prepare++;
      return {
        intent: "saved-creation",
        mintSignerRef: `launchseeds-mint-${mint}`,
      };
    },
    executeDeployment: async (intent) => {
      expect(intent).toBe("saved-creation");
      calls.execute++;
      return {
        status: calls.confirmed ? "confirmed" : "pending",
        signature: "creation-signature",
        mint,
      };
    },
  };
  return {
    get store() {
      return store;
    },
    settings,
    calls,
    provider,
    at: (n: number) => {
      clock = n;
    },
    due,
    mint,
    funding,
    reopen: () => {
      store.close();
      store = new Store(openLaunchseedsData(path));
    },
    close: () => {
      store.close();
      time.mockRestore();
    },
  };
}
test("integer wallet allocation totals exactly and validates each wallet minimum", () => {
  expect(allocatedBudget(500000001n, [5000, 3000, 2000])).toEqual([
    250000000n,
    150000000n,
    100000001n,
  ]);
  expect(() => allocatedBudget(100000000n, [9000, 500, 500])).toThrow(
    "at least",
  );
  expect(() => allocatedBudget(500000000n, [3333, 3333, 3333])).toThrow("100%");
  expect(() => allocatedBudget(500000000n, [5000, -1, 5001])).toThrow();
});
test("schedule boundaries and unsupported profit policies reject before any funds", () => {
  const f = fixture();
  try {
    expect(() =>
      validateSchedule({ ...f.settings, scheduledAt: Date.now() + 1000 }),
    ).toThrow("2 minutes");
    expect(() =>
      validateSchedule({
        ...f.settings,
        scheduledAt: Date.now() + 8 * 86400000,
      }),
    ).toThrow("7 days");
    expect(() =>
      parseLaunchSettings({
        ...f.settings,
        profitPolicy: { mode: "cashback" },
      }),
    ).toThrow();
    expect(() =>
      parseLaunchSettings({ ...f.settings, bundleMaxHoldMs: 3600000 }),
    ).toThrow();
    expect(() =>
      parseLaunchSettings({ ...f.settings, walletSharesBps: [10000, 0, 0] }),
    ).toThrow();
  } finally {
    f.close();
  }
});
test("funded schedules survive restart and cannot prepare or broadcast before due", async () => {
  const dir = mkdtempSync(join(tmpdir(), "launchseeds-schedule-"));
  const f = fixture(join(dir, "test.sqlite"));
  try {
    const service = new LaunchService(f.store, f.provider);
    const status = await service.create(
      input,
      "b".repeat(64),
      undefined,
      f.settings,
    );
    expect(status.status).toBe("funding");
    expect(status.plan?.wallets.map((w) => w.budgetLamports)).toEqual([
      "250000000",
      "150000000",
      "100000000",
    ]);
    const token = f.store.repo.tokens.getByHandle(status.handle)!;
    const original = f.store.repo.scheduledPlans.byToken(token.id)!;
    await service.process(token.id);
    expect(f.calls.prepare).toBe(0);
    expect(f.calls.execute).toBe(0);
    expect(pendingCapital(f.store.repo)).toBe(542100000n);
    expect(publicScheduledPlan(f.store, original.planHash)?.status).toBe(
      "scheduled",
    );
    f.reopen();
    f.at(f.due - 1);
    await new LaunchService(f.store, f.provider).process(token.id);
    expect(f.calls.prepare).toBe(0);
    f.at(f.due);
    await new LaunchService(f.store, f.provider).process(token.id);
    expect(f.calls.prepare).toBe(1);
    expect(f.calls.execute).toBe(1);
    f.reopen();
    f.calls.confirmed = true;
    await new LaunchService(f.store, f.provider).process(token.id);
    expect(f.calls.prepare).toBe(1);
    expect(f.store.repo.tokens.get(token.id)?.status).toBe("live");
    expect(f.store.repo.scheduledPlans.byToken(token.id)?.buyersJson).toBe(
      original.buyersJson,
    );
    const plan = publicScheduledPlan(f.store, original.planHash)!;
    expect(plan.mint).toBe(f.mint);
    expect(
      createHash("sha256")
        .update(JSON.stringify(plan.commitment))
        .digest("hex"),
    ).toBe(original.planHash);
    const json = JSON.stringify(plan);
    for (const secret of [
      "saved-creation",
      "accessHash",
      "fundingWallet",
      "intent",
      "b".repeat(64),
    ])
      expect(json).not.toContain(secret);
    expect(scheduledLaunches(f.store)).toHaveLength(1);
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("late payment never silently launches a missed schedule", async () => {
  const f = fixture();
  try {
    const service = new LaunchService(f.store, f.provider);
    const status = await service.create(
      input,
      "c".repeat(64),
      undefined,
      f.settings,
    );
    f.calls.late = true;
    f.at(f.due + 1);
    const token = f.store.repo.tokens.getByHandle(status.handle)!;
    await service.process(token.id);
    expect(f.calls.prepare).toBe(0);
    expect(f.calls.execute).toBe(0);
    expect(f.store.repo.tokens.get(token.id)?.error).toContain("refund review");
    expect(publicScheduledPlan(f.store, status.plan!.planHash)?.status).toBe(
      "missed",
    );
    expect(pendingCapital(f.store.repo)).toBe(0n);
  } finally {
    f.close();
  }
});
test("published cards render stored plans with no SSR network calls", async () => {
  const f = fixture();
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    await new LaunchService(f.store, f.provider).create(
      input,
      "d".repeat(64),
      undefined,
      f.settings,
    );
    globalThis.fetch = (() => {
      calls++;
      throw new Error("SSR network forbidden");
    }) as unknown as typeof fetch;
    const html = renderToString(renderHomePage(f.store));
    expect(html).toContain("launch-card");
    expect(html).toContain("$CLOCK");
    // A scheduled coin links to its coin page, never a separate schedule page.
    expect(html).toMatch(/href="\/coin\/[a-f0-9]{64}"/);
    expect(html).not.toContain("/schedule/");
    expect(html).not.toContain("<table");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = oldFetch;
    f.close();
  }
});
test("competing funded schedules use quote order, without reservation deadlock", async () => {
  const f = fixture();
  try {
    const service = new LaunchService(f.store, f.provider);
    const status = await service.create(
      input,
      "e".repeat(64),
      undefined,
      f.settings,
    );
    const first = f.store.repo.tokens.getByHandle(status.handle)!;
    await service.process(first.id);
    const second = insertToken(f.store, {
      status: "funding",
      launchSettingsJson: JSON.stringify(f.settings),
      requiredLamports: "35000000",
      fundingReceivedLamports: "35000000",
      quoteExpiresAt: f.due,
    });
    f.store.repo.deposits.record({
      tokenId: second.id,
      signature: "second-deposit",
      lamports: "35000000",
      confirmedAt: f.due - 299999,
      confirmedSlot: 2,
      refundSignature: null,
    });
    expect(pendingCapital(f.store.repo, first.id)).toBe(0n);
    expect(pendingCapital(f.store.repo, second.id)).toBe(542100000n);
    expect(pendingCapital(f.store.repo)).toBe(1084200000n);
  } finally {
    f.close();
  }
});
test("opening the new schema preserves old positions, settings and signed exit journals", () => {
  const dir = mkdtempSync(join(tmpdir(), "launchseeds-legacy-schedule-")),
    path = join(dir, "legacy.sqlite");
  let upgraded: Store | undefined;
  try {
    const { scheduledPlans: _new, ...prior } = schemas;
    const old = new Database(
      path,
      {
        ...prior,
        launchBundles: prior.launchBundles.extend({
          settlement: z
            .enum(["owner", "holders", "token"])
            .nullable()
            .default(null),
        }),
      },
      { reactive: false },
    );
    const {
      scheduledAt: _at,
      walletSharesBps: _shares,
      profitPolicy: _policy,
      ...legacySettings
    } = DEFAULT_LAUNCH_SETTINGS;
    const token = old.tokens.insert(
      tokenFixture({
        mint: address(),
        launchSettingsJson: JSON.stringify(legacySettings),
      }),
    );
    const bundle = old.launchBundles.insert({
      tokenId: token.id,
      status: "holding",
      buyersJson: "[]",
      costLamports: "500000000",
      createdAt: 1,
      exitSignature: "kept-signature",
      exitTransaction: "kept-signed-bytes",
      exitLastValidBlockHeight: 20,
    });
    old.close();
    upgraded = new Store(openLaunchseedsData(path));
    expect(upgraded.repo.tokens.get(token.id)?.status).toBe("live");
    expect(upgraded.repo.tokens.get(token.id)?.holdersSnapshotAt).toBe(0);
    expect(
      storedLaunchSettings(
        upgraded.repo.tokens.get(token.id)?.launchSettingsJson,
      ).scheduledAt,
    ).toBeNull();
    expect(upgraded.repo.launchBundles.byToken(token.id)).toMatchObject({
      id: bundle.id,
      status: "holding",
      exitSignature: "kept-signature",
      exitTransaction: "kept-signed-bytes",
      exitLastValidBlockHeight: 20,
    });
    expect(upgraded.repo.scheduledPlans.byToken(token.id)).toBeNull();
  } finally {
    upgraded?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("unpaid quotes reserve capacity, own amendments reuse it, and expiry releases it", async () => {
  const f = fixture();
  let balance = 1000000000;
  const connection = {
    getMultipleAccountsInfo: async () => [{ lamports: balance }],
  } as any;
  try {
    f.provider.checkProtectionBudget = (amount, id) =>
      assertProtectionBudget(f.store, amount, id);
    await refreshProtectionBudget(f.store, connection, address());
    const status = await new LaunchService(f.store, f.provider).create(
      input,
      "f".repeat(64),
      undefined,
      f.settings,
    );
    const id = f.store.repo.tokens.getByHandle(status.handle)!.id;
    expect(protectionBudget(f.store).fresh).toBe(false);
    await refreshProtectionBudget(f.store, connection, address());
    expect(protectionBudget(f.store).maxLamports).toBe(415800000);
    expect(() => assertProtectionBudget(f.store, 500000000)).toThrow();
    expect(() => assertProtectionBudget(f.store, 500000000, id)).not.toThrow();
    balance = 200000000;
    await refreshProtectionBudget(f.store, connection, address());
    expect(protectionBudget(f.store).maxLamports).toBe(0);
    expect(() => assertProtectionBudget(f.store, 500000000, id)).toThrow();
    f.at(f.due + 1);
    await refreshProtectionBudget(f.store, connection, address());
    expect(protectionBudget(f.store).maxLamports).toBe(157900000);
    expect(pendingCapital(f.store.repo)).toBe(0n);
  } finally {
    f.close();
  }
});
test("concurrent preparations cannot publish payment wallets against the same capital", async () => {
  const f = fixture();
  try {
    const connection = {
      getMultipleAccountsInfo: async () => [{ lamports: 1000000000 }],
    } as any;
    await refreshProtectionBudget(f.store, connection, address());
    f.provider.checkProtectionBudget = (amount, id) =>
      assertProtectionBudget(f.store, amount, id);
    f.provider.createMint = () => {
      const mint = address();
      return { mint, mintSignerRef: `launchseeds-mint-${mint}` };
    };
    const original = f.provider.prepare;
    let ready = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    f.provider.prepare = async (args) => {
      if (++ready === 2) release();
      await gate;
      return { ...(await original(args)), mintSignerRef: args.mintSignerRef! };
    };
    const service = new LaunchService(f.store, f.provider);
    const results = await Promise.allSettled([
      service.create(
        { ...input, name: "First" },
        "1".repeat(64),
        undefined,
        f.settings,
      ),
      service.create(
        { ...input, name: "Second" },
        "2".repeat(64),
        undefined,
        f.settings,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = f.store.repo.tokens.all();
    expect(rows.filter((t) => t.status === "funding")).toHaveLength(1);
    expect(
      rows.filter((t) => t.status === "preparing")[0]?.fundingWallet,
    ).toBeNull();
  } finally {
    f.close();
  }
});
test("unfunded edits update the public hash but preserve wallets; funded plans cannot change", async () => {
  const f = fixture();
  try {
    f.provider.deposits = async () => [];
    const service = new LaunchService(f.store, f.provider),
      key = "3".repeat(64);
    const status = await service.create(input, key, undefined, f.settings);
    const revised = await service.amend(
      status.handle,
      { ...input, name: "Revised" },
      key,
      { ...f.settings, walletSharesBps: [4000, 3000, 3000] },
      null,
    );
    expect(revised.fundingWallet).toBe(status.fundingWallet);
    expect(revised.plan?.planHash).not.toBe(status.plan?.planHash);
    expect(revised.plan?.wallets.map((w) => w.wallet)).toEqual(
      status.plan?.wallets.map((w) => w.wallet),
    );
    expect(revised.plan?.wallets.map((w) => w.budgetLamports)).toEqual([
      "200000000",
      "150000000",
      "150000000",
    ]);
    const token = f.store.repo.tokens.getByHandle(status.handle)!;
    f.store.repo.deposits.record({
      tokenId: token.id,
      signature: "paid",
      lamports: "35000000",
      confirmedAt: Date.now(),
      confirmedSlot: 1,
      refundSignature: null,
    });
    await expect(
      service.amend(status.handle, input, key, f.settings, null),
    ).rejects.toThrow("funded");
    expect(f.store.repo.scheduledPlans.byToken(token.id)?.planHash).toBe(
      revised.plan?.planHash,
    );
  } finally {
    f.close();
  }
});

test("scheduled holder snapshots build Gravity without a strategy or governance state", async () => {
  const f = fixture();
  try {
    const token = insertToken(f.store, {
      status: "live",
      mint: address(),
      launchSettingsJson: JSON.stringify(f.settings),
    });
    const wallet = address(),
      now = Date.now();
    let observedAt = now,
      slot = 5;
    const services = createLaunchseedsCoreServices({
      repo: f.store.repo,
      holders: {
        balance: async () => ({
          wallet,
          balanceRaw: "1000000",
          slot: 5,
          observedAt: now,
        }),
        snapshot: async () => ({
          complete: true,
          slot,
          observedAt,
          balances: [{ wallet, balanceRaw: "1000000" }],
        }),
      },
      market: { priceUsd: async () => "1" },
      voteVerifier: { verify: async () => true },
      chain: "solana",
      clock: () => now,
      requireFreshSnapshot: true,
    });
    expect(f.store.repo.operations.state(token.id)).toBeNull();
    await services.holders.syncSnapshot(token.id);
    expect(f.store.repo.tokens.get(token.id)?.holdersSnapshotAt).toBe(now);
    expect(await services.gravity.accrueMinute(token.id)).toBe(true);
    expect(
      BigInt(f.store.repo.holders.get(token.id, wallet)!.gravityMicros),
    ).toBeGreaterThan(0n);
    observedAt = now - 1;
    slot = 6;
    expect(await services.holders.syncSnapshot(token.id)).toBe(0);
    expect(f.store.repo.tokens.get(token.id)?.holdersSnapshotAt).toBe(now);
    expect(f.store.repo.operations.state(token.id)).toBeNull();
  } finally {
    f.close();
  }
});


test("reserved CA and creator-fee address are public before launch and remain committed through deployment", async () => {
  const creator=address();const f=fixture(":memory:",{publishMint:true,holderRewards:false,feesTo:creator});
  try {
    const service=new LaunchService(f.store,f.provider);
    const status=await service.create(input,"c".repeat(64),undefined,f.settings);
    expect(status.status).toBe("funding");expect(status.mint).toBe(f.mint);
    expect(status.plan?.mint).toBe(f.mint);
    expect(status.plan?.commitment).toMatchObject({version:2,mint:f.mint,feesTo:creator,tradingFees:"Creator fees to published wallet"});
    const planHash=status.plan!.planHash;
    let feeTarget:string|null|undefined,holderRewards:boolean|undefined;
    const prepare=f.provider.prepareDeployment!;
    f.provider.prepareDeployment=async args=>{feeTarget=args.feesTo;holderRewards=args.holderRewards;return prepare(args);};
    f.at(f.due);await service.process(f.store.repo.tokens.getByHandle(status.handle)!.id);
    f.calls.confirmed=true;await service.process(f.store.repo.tokens.getByHandle(status.handle)!.id);
    const live=service.publicStatus(status.handle);
    expect(live.mint).toBe(f.mint);expect(live.plan!.planHash).toBe(planHash);
    expect(feeTarget).toBe(creator);expect(holderRewards).toBe(false);
    expect(()=>validateSchedule({...f.settings,feesTo:"1".repeat(44)})).toThrow("creator-fee");
    expect(()=>parseLaunchSettings({...f.settings,holderRewards:true})).toThrow();
    expect(()=>parseLaunchSettings({...f.settings,feesTo:null})).toThrow();
  } finally {f.close();}
});

test("old /schedule links redirect to the coin page", async () => {
  const { GET } = await import("../app/schedule/[id]/route");
  const hash = "a".repeat(64);
  const response = GET(new Request(`http://localhost/schedule/${hash}`));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(`/coin/${hash}`);
});
