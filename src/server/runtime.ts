import { Store } from "./store";
import { openLaunchseedsData } from "../db";
import { LaunchService } from "./launch";
import { SolardLaunchProvider, SolardSource } from "./solard";
import { solToLamports } from "../shared/domain";
let instance: Store | undefined;
let trading: Promise<SolardSource> | undefined;
/** Signing client is separate from page read clients and created only for live actions. */
export function getTradingSolard() {
  if (process.env.LAUNCHSEEDS_LIVE_OPERATIONS !== "true")
    throw new Error("Live operations disabled");
  return (trading ??= SolardSource.createTrader(
    process.env.SOLANA_RPC_URL || "",
  ).catch((error) => {
    trading = undefined;
    throw error;
  }));
}
export const getStore = () =>
  (instance ??= new Store(
    openLaunchseedsData(process.env.LAUNCHSEEDS_DB_PATH || "./data/launchseeds.sqlite"),
  ));
let launchPromise:
  | Promise<{ service: LaunchService; provider: SolardLaunchProvider | null }>
  | undefined;
function launchRuntime() {
  return (launchPromise ??= (async () => {
    const store = getStore();
    if (
      process.env.LAUNCHSEEDS_LAUNCH_ENABLED !== "true" ||
      process.env.LAUNCHSEEDS_LIVE_OPERATIONS !== "true" ||
      process.env.LAUNCHSEEDS_WORKER_ENABLED !== "true"
    )
      return { service: new LaunchService(store), provider: null };
    if (!process.env.SOLANA_RPC_URL || !process.env.LAUNCH_BASE_SOL)
      throw new Error("Launch configuration is incomplete");
    const provider = await SolardLaunchProvider.create(
      store,
      process.env.SOLANA_RPC_URL,
      solToLamports(process.env.LAUNCH_BASE_SOL),
    );
    return { service: new LaunchService(store, provider), provider };
  })().catch((error) => {
    launchPromise = undefined;
    throw error;
  }));
}
export async function getLaunchService() {
  return (await launchRuntime()).service;
}
