import { refreshSiteSnapshots } from "../src/server/token-site";
import { refreshHomeSnapshot } from "../src/server/home-snapshot-worker";
import "../src/server/rpc-pacing-install";
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
import {runLaunchCycle,startLaunchLoop} from "../src/server/launch-loop";
import {watchLaunchWake} from "../src/server/launch-wake";
import { getWorkerHealth } from "../src/server/launch-health";
import { feeClaimsEnabled } from "../src/server/fee-claimer";
import { createFeeClaimer } from "../src/server/fee-claimer-runtime";
import { packExecutionsEnabled } from "../src/server/pack-executor";
import { createPackExecutor } from "../src/server/pack-executor-runtime";
import { stockExecutionsEnabled } from "../src/server/stock-executor";
import { createStockExecutor } from "../src/server/stock-executor-runtime";
import { marketMakingEnabled } from "../src/server/market-maker";
import { createMarketMaker } from "../src/server/market-maker-runtime";
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
let rewardsSource: SolardSource | undefined;
let launchProvider: SolardLaunchProvider | undefined;
let fastLaunch: ReturnType<typeof startLaunchLoop> | undefined;
let closeLaunchWake: (()=>void) | undefined;
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
  // Off unless [launchseeds] fee_claims = true (and live operations are on).
  rewardsSource = feeClaimsEnabled() || packExecutionsEnabled() || stockExecutionsEnabled() || marketMakingEnabled() ? await SolardSource.createTrader(rpcUrl) : undefined;
  const fees = feeClaimsEnabled() ? createFeeClaimer(store, rewardsSource!) : undefined;
  if (fees) console.log("Fee claims enabled");
  // Off unless [launchseeds] pack_executions = true: buys and opens packs with treasury funds.
  const packs = packExecutionsEnabled() ? createPackExecutor(store, rewardsSource!, rpcUrl) : undefined;
  if (packs) console.log("Pack executions enabled");
  // Off unless [launchseeds] stock_executions = true: buys stock (e.g. GLDx) and sends wins.
  const stocks = stockExecutionsEnabled() ? createStockExecutor(store, rewardsSource!, rpcUrl) : undefined;
  if (stocks) console.log("Stock executions enabled");
  // Off unless [launchseeds] market_making = true: trades holder-reward coins' market-making wallets.
  const market = marketMakingEnabled() ? createMarketMaker(store, rewardsSource!, rpcUrl) : undefined;
  if (market) console.log("Market making enabled");
  const once = process.argv.includes("--once");
  // Trade events only speed up holder refreshes; the minute cycle still syncs
  // snapshots and Gravity. Off by default: the WebSocket log subscription burned
  // RPC quota, and polling alone stays inside the paced HTTP budget.
  const tradeListener = process.env.LAUNCHSEEDS_TRADE_LISTENER === "true";
  const syncListener = async () => {
    if (!tradeListener) return;
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
  if (!once && launch) {
    const service = launch;
    fastLaunch = startLaunchLoop({
      cycle: () => runLaunchCycle({store,launch:service,bundles:launchProvider?.bundles??undefined}),
      onStart: () => { health.startCycle(workerId); },
      onFinish: result => {
        health.finishCycle(workerId,result.errors.length===0,result.errors.map(e=>e.operation).join(","));
        if(result.errors.length)console.error(JSON.stringify(result.errors));
      },
      onError: () => { health.finishCycle(workerId,false,"launch cycle"); },
    });
    closeLaunchWake=watchLaunchWake(fastLaunch.wake);
  }
  if (!once) await syncListener();
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
      services,
      launch: once ? launch : undefined,
      fees,
      packs,
      stocks,
      market,
      bundles: fastLaunch ? undefined : launchProvider?.bundles ?? undefined,
    });
    if (!fastLaunch) health.finishCycle(
      workerId,
      Boolean(launch) && result.errors.length === 0,
      result.errors
        .map((item) => item.operation)
        .slice(0, 5)
        .join(","),
    );
    if (result.errors.length) console.error(JSON.stringify(result.errors));
    if (!once) await syncListener();
    // Read-only page observations are produced here, never during SSR.
    try { await refreshHomeSnapshot(store); await refreshSiteSnapshots(); }
    catch (error) { console.error("Home observation refresh failed", error instanceof Error ? error.message : "Unknown error"); }
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
  await listener?.close();
  source?.close();
  rewardsSource?.close();
  launchProvider?.close();
  store.close();
  closeSync(lock);
  unlinkSync(lockPath);
}
