import { expect, test } from "bun:test";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { LaunchService, type LaunchProvider } from "../src/server/launch";
import { runLaunchCycle, startLaunchLoop } from "../src/server/launch-loop";
import { notifyLaunchWorker, watchLaunchWake } from "../src/server/launch-wake";
import { insertToken, WALLET } from "./fixtures";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("launch-only cycles persist a signature and promptly reconcile the same transaction", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  let prepared = 0,
    executed = 0;
  const token = insertToken(store, {
    status: "funding",
    mint: null,
    launchedAt: null,
    metadataUri: "ipfs://test",
  });
  const unfunded = insertToken(store, {
    status: "funding",
    mint: null,
    launchedAt: null,
    fundingWallet: "So11111111111111111111111111111111111111112",
  });
  const provider = {
    fundedWallets: async () => new Set([WALLET]),
    deposits: async () => [
      {
        signature: "funding",
        lamports: 20_000_000,
        confirmedAt: 1,
        confirmedSlot: 1,
      },
    ],
    prepareDeployment: async () => {
      prepared++;
      return { intent: "same-persisted-bytes", mintSignerRef: "fixture" };
    },
    executeDeployment: async (intent: string) => {
      expect(store.repo.tokens.get(token.id)!.intent).toBe(intent);
      expect(intent).toBe("same-persisted-bytes");
      executed++;
      return {
        status: executed === 1 ? "pending" : "confirmed",
        signature: "same-signature",
        mint: WALLET,
      };
    },
  } as unknown as LaunchProvider;
  const launch = new LaunchService(store, provider);
  try {
    expect((await runLaunchCycle({ store, launch })).errors).toEqual([]);
    expect(store.repo.tokens.get(token.id)!.status).toBe("deploying");
    expect(store.repo.tokens.get(token.id)!.deploySignature).toBe(
      "same-signature",
    );
    expect(store.repo.tokens.get(unfunded.id)!.status).toBe("funding");
    expect((await runLaunchCycle({ store, launch })).errors).toEqual([]);
    expect(store.repo.tokens.get(token.id)!.status).toBe("live");
    expect(prepared).toBe(1);
    expect(executed).toBe(2);
  } finally {
    store.close();
  }
});

test("a processing lease prevents overlapping deployment preparation", async () => {
  const store = new Store(openLaunchseedsData(":memory:")),
    token = insertToken(store, {
      status: "funding",
      mint: null,
      launchedAt: null,
      metadataUri: "ipfs://test",
    });
  let release!: () => void,
    started!: () => void,
    preparations = 0;
  const waiting = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  const provider = {
    deposits: async () => [
      {
        signature: "paid",
        lamports: 20_000_000,
        confirmedAt: 1,
        confirmedSlot: 1,
      },
    ],
    prepareDeployment: async () => {
      preparations++;
      started();
      await waiting;
      return { intent: "one", mintSignerRef: "mint" };
    },
    executeDeployment: async () => ({
      status: "pending",
      signature: "signature",
      mint: WALLET,
    }),
  } as unknown as LaunchProvider;
  const service = new LaunchService(store, provider);
  try {
    const first = service.process(token.id);
    await ready;
    await new LaunchService(store, provider).process(token.id);
    expect(preparations).toBe(1);
    expect(store.repo.tokens.get(token.id)!.leaseUntil).toBeGreaterThan(
      Date.now(),
    );
    release();
    await first;
    expect(store.repo.tokens.get(token.id)!.leaseId).toBe("");
  } finally {
    release?.();
    store.close();
  }
});

test("funded launches persist the capital wait reason and clear it once preparation succeeds", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  const token = insertToken(store, {
    status: "funding",
    mint: null,
    launchedAt: null,
    metadataUri: "ipfs://test",
  });
  let waiting = true,
    executed = 0;
  const provider = {
    deposits: async () => [
      {
        signature: "paid",
        lamports: 20_000_000,
        confirmedAt: 1,
        confirmedSlot: 1,
      },
    ],
    prepareDeployment: async () =>
      waiting
        ? { wait: "Freeing sniper-protection capital: selling an earlier coin" }
        : { intent: "prepared", mintSignerRef: "mint" },
    executeDeployment: async () => {
      executed++;
      return { status: "pending", signature: "signature", mint: WALLET };
    },
  } as unknown as LaunchProvider;
  const service = new LaunchService(store, provider);
  try {
    await service.process(token.id);
    expect(store.repo.tokens.get(token.id)!.error).toContain(
      "Freeing sniper-protection capital",
    );
    expect(executed).toBe(0);
    waiting = false;
    await service.process(token.id);
    expect(store.repo.tokens.get(token.id)!.error).toBeNull();
    expect(executed).toBe(1);
  } finally {
    store.close();
  }
});

test("wakeups coalesce without overlapping cycles and shutdown drains the active task", async () => {
  let calls = 0,
    active = 0,
    max = 0,
    release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const loop = startLaunchLoop({
    intervalMs: 5,
    cycle: async () => {
      calls++;
      active++;
      max = Math.max(max, active);
      if (calls === 1) await hold;
      active--;
      return { errors: [] };
    },
  });
  loop.wake();
  loop.wake();
  expect(calls).toBe(1);
  release();
  await Bun.sleep(15);
  await loop.stop();
  const stopped = calls;
  await Bun.sleep(10);
  expect(max).toBe(1);
  expect(calls).toBe(stopped);
  expect(calls).toBeGreaterThan(1);
});

test("cross-process wake file signals the launch loop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "launchseeds-launch-wake-")),
    path = join(directory, "launch-wake");
  let count = 0;
  let resolveWake!: () => void;
  const seen = new Promise<void>((r) => (resolveWake = r)),
    close = watchLaunchWake(() => {
      count++;
      resolveWake();
    }, path);
  try {
    notifyLaunchWorker(path);
    await Promise.race([
      seen,
      Bun.sleep(500).then(() => {
        throw Error("Missing wake signal");
      }),
    ]);
    expect(count).toBeGreaterThan(0);
  } finally {
    close();
    unlinkSync(path);
    rmdirSync(directory);
  }
});

test("the wallet that paid first is recorded as the launcher, once", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  const token = insertToken(store, {
    status: "funding",
    mint: null,
    launchedAt: null,
    metadataUri: "ipfs://test",
    launcherWallet: null,
  });
  const payer = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    late = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const provider = {
    deposits: async () => [
      {
        signature: "b",
        lamports: 1,
        confirmedAt: 2,
        confirmedSlot: 2,
        sender: late,
      },
      {
        signature: "a",
        lamports: 20_000_000,
        confirmedAt: 1,
        confirmedSlot: 1,
        sender: payer,
      },
    ],
    prepareDeployment: async () => ({ wait: "later", mintSignerRef: "m" }),
    executeDeployment: async () => {
      throw new Error("unused");
    },
  } as unknown as LaunchProvider;
  try {
    await runLaunchCycle({ store, launch: new LaunchService(store, provider) });
    expect(store.repo.tokens.get(token.id)!.launcherWallet).toBe(payer);
    expect(store.repo.tokens.recordLauncher(token.id, late)).toBe(false);
  } finally {
    store.close();
  }
});
