import { createLaunchseedsCoreServices } from "../src/services";
import { createSolardIntegrations } from "../src/integrations/solard";
import { ed25519VoteVerifier } from "../src/integrations/ed25519";
import {
  openSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  writeSync,
  readFileSync,
} from "node:fs";
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
const lock = acquireLock(lockPath);
/** Single-worker lock holding the owner PID. A lock left by a force-killed
 * worker (bgrun restart on Windows skips the finally block) is taken over. */
function acquireLock(path: string) {
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, String(process.pid));
    return fd;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = Number(readFileSync(path, "utf8").trim());
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
      }
    };
    if (Number.isSafeInteger(owner) && owner > 0 && alive(owner))
      throw new Error(`Another LaunchSeeds worker is running (pid ${owner})`);
    unlinkSync(path);
    return acquireLock(path);
  }
}
const store = getStore();
const health = getWorkerHealth();
const workerId = health.begin();
// RPC work can outlast the heartbeat window even when the cycle is healthy.
// Completion age and the stalled-cycle guard remain independent admission gates.
const heartbeat = setInterval(() => health.touch(workerId), 5_000);
heartbeat.unref();
let running = true;
let listener: TradeListener | undefined;
let source: SolardSource | undefined;
let launchProvider: SolardLaunchProvider | undefined;
try {
  source = await SolardSource.create(rpcUrl);
  let launch: LaunchService | undefined;
  if (live && process.env.LAUNCHSEEDS_LAUNCH_ENABLED === "true") {
    if (!process.env.LAUNCH_BASE_SOL)
      throw new Error("Launch config is incomplete");
    launchProvider = await SolardLaunchProvider.create(
      store,
      rpcUrl,
      solToLamports(process.env.LAUNCH_BASE_SOL),
    );
    launch = new LaunchService(store, launchProvider);
  }
  const services = createLaunchseedsCoreServices({
    repo: store.repo,
    ...createSolardIntegrations(store.repo, source),
    voteVerifier: ed25519VoteVerifier,
    chain: process.env.SOLANA_CHAIN || "solana:mainnet-beta",
    requireFreshSnapshot: true,
  });
  const refresh = async (mint: string) => {
    const token = store.listLive().find((token) => token.mint === mint);
    if (!token) return;
    // Trade events have no verified participant wallet in the pinned SDK.
    // Refresh the authoritative complete snapshot; Gravity runs only on the minute cycle.
    await services.holders.syncSnapshot(token.id);
  };
  const mints = () => store.listLive().map((token) => token.mint);
  const once = process.argv.includes("--once");
  // Trade events only speed up holder refreshes; the minute cycle still syncs
  // snapshots and Gravity. An RPC rejecting WebSockets must not stop the worker.
  const syncListener = async () => {
    try {
      if (!listener) {
        listener = await source!.listen(mints(), refresh);
        return;
      }
      const active = mints();
      await listener.add(
        active.filter((mint) => !listener!.list().includes(mint)),
      );
      await listener.remove(
        listener.list().filter((mint) => !active.includes(mint)),
      );
    } catch (error) {
      console.error(
        "Trade listener unavailable; retrying next cycle:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };
  if (!once) await syncListener();
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
      services,
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
    if (!once) await syncListener();
    if (once) {
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    for (let second = 0; running && second < 60; second++) {
      await Bun.sleep(1000);
    }
  } while (running);
} finally {
  clearInterval(heartbeat);
  health.stop(workerId);
  await listener?.close();
  source?.close();
  launchProvider?.close();
  store.close();
  closeSync(lock);
  unlinkSync(lockPath);
}
