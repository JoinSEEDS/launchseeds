import { openSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { getStore } from "../src/server/runtime";
import { SolardSource, SolardLaunchProvider } from "../src/server/solard";
import type { TradeListener } from "../src/server/solard-sdk";
import { LaunchService } from "../src/server/launch";
import { runCycle } from "../src/server/worker";
import { getWorkerHealth } from "../src/server/launch-health";
import { solToLamports } from "../src/shared/domain";
if (process.env.LAUNCHSEEDS_WORKER_ENABLED !== "true")
  throw new Error(
    "Workers are disabled. Configure and explicitly enable LAUNCHSEEDS_WORKER_ENABLED before running.",
  );
const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");
const live = process.env.LAUNCHSEEDS_LIVE_OPERATIONS === "true";
mkdirSync("./data", { recursive: true });
const lockPath = "./data/launchseeds-worker.lock";
const lock = openSync(lockPath, "wx");
const store = getStore();
const health = getWorkerHealth();
const workerId = health.begin();
let running = true;
let listener: TradeListener | undefined;
let source: SolardSource | undefined;
let launchProvider: SolardLaunchProvider | undefined;
try {
  source = await SolardSource.create(rpcUrl);
  let launch: LaunchService | undefined;
  if (live && process.env.LAUNCHSEEDS_LAUNCH_ENABLED === "true") {
    if (!process.env.PUBLIC_BASE_URL || !process.env.LAUNCH_BASE_SOL)
      throw new Error("Launch config is incomplete");
    launchProvider = await SolardLaunchProvider.create(
      store,
      rpcUrl,
      process.env.PUBLIC_BASE_URL,
      solToLamports(process.env.LAUNCH_BASE_SOL),
    );
    launch = new LaunchService(store, launchProvider);
  }
  const refresh = async (mint: string) => {
    const token = store.listLive().find((token) => token.mint === mint);
    if (!token) return;
    const data = await source!.sample(
      mint,
      (process.env.LAUNCHSEEDS_EXCLUDED_WALLETS || "").split(",").filter(Boolean),
    );
    store.applySnapshot(token.id, data.snapshot, data.priceUsd);
  };
  const mints = () => store.listLive().map((token) => token.mint);
  const once = process.argv.includes("--once");
  if (!once) listener = await source.listen(mints(), refresh);
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  do {
    health.startCycle(workerId);
    const result = await runCycle({
      store,
      source,
      launch,
    });
    health.finishCycle(
      workerId,
      Boolean(launch) && result.errors.length === 0,
      result.errors
        .map((item) => item.operation)
        .slice(0, 5)
        .join(","),
    );
    if (result.errors.length) console.error(JSON.stringify(result.errors));
    if (listener) {
      const active = mints();
      await listener.add(
        active.filter((mint) => !listener!.list().includes(mint)),
      );
      await listener.remove(
        listener.list().filter((mint) => !active.includes(mint)),
      );
    }
    if (once) {
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    for (let second = 0; running && second < 60; second++) {
      await Bun.sleep(1000);
      if (second % 5 === 4) health.touch(workerId);
    }
  } while (running);
} finally {
  health.stop(workerId);
  await listener?.close();
  source?.close();
  launchProvider?.close();
  store.close();
  closeSync(lock);
  unlinkSync(lockPath);
}
