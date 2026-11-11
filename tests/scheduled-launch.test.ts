import { Database, z } from "sqlite-zod-orm";
import { schemas } from "../src/db/schema";
import { storedLaunchSettings } from "../src/domain/launch-settings";
import { tokenFixture } from "./fixtures";
import { createHash } from "node:crypto";
import { scheduledSettings, insertToken } from "./fixtures";
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
import {
  publicScheduledPlan,
  scheduledLaunches,
} from "../src/server/scheduled-launches";
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
    ...scheduledSettings(due, [250000000, 150000000, 100000000]),
    ...overrides,
  });
  const calls = { prepare: 0, execute: 0, confirmed: false, late: false };
  const provider: LaunchProvider = {
    createMint: () => ({ mint, mintSignerRef: `launchseeds-mint-${mint}` }),
    userBatches: true,
    validateUserBatchLayout: async () => {},
    planBuyers: () => [],
    planColumns: (_token, columns) =>
      columns.flatMap((budgets, batchIndex) =>
        budgets.map((n, i) => ({
          name: `buyer-${i}`,
          wallet: wallets[i]!,
          budgetLamports: n.toString(),
          batchIndex,
          role: i === 0 ? ("signer" as const) : ("fresh" as const),
        })),
      ),
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
        lamports: 2000000000,
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
        userBatches: null,
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
    expect(html).toContain("token-card");
    expect(html).toContain("$CLOCK");
    // A scheduled coin links to its coin page, never a separate schedule page.
    expect(html).toMatch(/href="\/coin\/[1-9A-HJ-NP-Za-km-z]{32,44}"/);
    expect(html).not.toContain("/schedule/");
    expect(html).not.toContain("<table");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = oldFetch;
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
      { ...f.settings, ...scheduledSettings(f.settings.scheduledAt!, [200000000, 150000000, 150000000]) },
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
      service.amend(status.handle, input, key, f.settings),
    ).rejects.toThrow("funded");
    expect(f.store.repo.scheduledPlans.byToken(token.id)?.planHash).toBe(
      revised.plan?.planHash,
    );
  } finally {
    f.close();
  }
});



test("reserved CA and creator-fee address are public before launch and remain committed through deployment", async () => {
  const creator=address();const f=fixture(":memory:",{publishMint:true,feesTo:creator});
  try {
    const service=new LaunchService(f.store,f.provider);
    const status=await service.create(input,"c".repeat(64),undefined,f.settings);
    expect(status.status).toBe("funding");expect(status.mint).toBe(f.mint);
    expect(status.plan?.mint).toBe(f.mint);
    expect(status.plan?.commitment).toMatchObject({version:1,mint:f.mint,feesTo:creator});
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

test("the launcher stays the coin's owner on LaunchSeeds after preparation; on chain the treasury creates it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "launchseeds-owner-"));
  const f = fixture(join(dir, "test.sqlite"));
  try {
    const owner = "7GkPq2RdT8xeFq3N9tLmBz8ukV1cHn2eQ7saLm4ra8Pz";
    const status = await new LaunchService(f.store, f.provider).create(input, "c".repeat(64), undefined, f.settings, owner);
    expect(f.store.repo.tokens.getByHandle(status.handle)!.creatorWallet).toBe(owner);
  } finally {
    f.close();
  }
});
