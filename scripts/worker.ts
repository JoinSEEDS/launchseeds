import "../src/server/rpc-pacing-install";
import {
  openSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  writeSync,
  readFileSync,
} from "node:fs";
import { getStore } from "../src/server/runtime";
import { SolardLaunchProvider } from "../src/server/solard";
import { LaunchService } from "../src/server/launch";
import { runCycle } from "../src/server/worker";
import { runLaunchCycle, startLaunchLoop } from "../src/server/launch-loop";
import { watchLaunchWake } from "../src/server/launch-wake";
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
const lock = await acquireLockWhenFree(lockPath);
/** A restart can start this worker before the old one has exited: wait up to
 * 2 minutes (it finishes its cycle first) instead of leaving no worker at all. */
async function acquireLockWhenFree(path: string, waitMs = 120_000) {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      return acquireLock(path);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message.startsWith("Another LaunchSeeds worker")
        ) ||
        Date.now() >= until
      )
        throw error;
      await Bun.sleep(1_000);
    }
  }
}
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
let launchProvider: SolardLaunchProvider | undefined;
let fastLaunch: ReturnType<typeof startLaunchLoop> | undefined;
let closeLaunchWake: (() => void) | undefined;
try {
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
  const once = process.argv.includes("--once");
  if (!once && launch) {
    const service = launch;
    fastLaunch = startLaunchLoop({
      cycle: async () => {
        const result = await runLaunchCycle({
          store,
          launch: service,
          bundles: launchProvider?.bundles ?? undefined,
        });
        return result;
      },
      onStart: () => {
        health.startCycle(workerId);
      },
      onFinish: (result) => {
        health.finishCycle(
          workerId,
          result.errors.length === 0,
          result.errors.map((e) => e.operation).join(","),
        );
        if (result.errors.length) console.error(JSON.stringify(result.errors));
      },
      onError: () => {
        health.finishCycle(workerId, false, "launch cycle");
      },
    });
    closeLaunchWake = watchLaunchWake(fastLaunch.wake);
  }
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  do {
    if (!fastLaunch) health.startCycle(workerId);
    const result = await runCycle({
      store,
      launch: once ? launch : undefined,
      bundles: fastLaunch ? undefined : (launchProvider?.bundles ?? undefined),
    });
    if (!fastLaunch)
      health.finishCycle(
        workerId,
        Boolean(launch) && result.errors.length === 0,
        result.errors
          .map((item) => item.operation)
          .slice(0, 5)
          .join(","),
      );
    if (result.errors.length) console.error(JSON.stringify(result.errors));
    if (once) {
      if (result.errors.length) process.exitCode = 1;
      break;
    }
    for (let second = 0; running && second < 60; second++) {
      await Bun.sleep(1000);
    }
  } while (running);
} finally {
  closeLaunchWake?.();
  await fastLaunch?.stop();
  clearInterval(heartbeat);
  health.stop(workerId);
  launchProvider?.close();
  store.close();
  closeSync(lock);
  unlinkSync(lockPath);
}
