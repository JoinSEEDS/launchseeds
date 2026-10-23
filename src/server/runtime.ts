import { Store } from "./store";
import { openLaunchseedsData } from "../db";
import { LaunchService } from "./launch";
import { SolardLaunchProvider } from "./solard";
import { solToLamports } from "../shared/domain";
let instance: Store | undefined;
export const getStore = () =>
  (instance ??= new Store(
    openLaunchseedsData(process.env.LAUNCHSEEDS_DB_PATH || "./data/launchseeds-v2.sqlite"),
  ));
let launchPromise: Promise<LaunchService> | undefined;
export async function getLaunchService() {
  return (launchPromise ??= (async () => {
    const store = getStore();
    if (
      process.env.LAUNCHSEEDS_LAUNCH_ENABLED !== "true" ||
      process.env.LAUNCHSEEDS_LIVE_OPERATIONS !== "true" ||
      process.env.LAUNCHSEEDS_WORKER_ENABLED !== "true"
    )
      return new LaunchService(store);
    if (
      !process.env.SOLANA_RPC_URL ||
      !process.env.PUBLIC_BASE_URL ||
      !process.env.LAUNCH_BASE_SOL
    )
      throw new Error("Launch configuration is incomplete");
    return new LaunchService(
      store,
      await SolardLaunchProvider.create(
        store,
        process.env.SOLANA_RPC_URL,
        process.env.PUBLIC_BASE_URL,
        solToLamports(process.env.LAUNCH_BASE_SOL),
      ),
    );
  })().catch((error) => {
    launchPromise = undefined;
    throw error;
  }));
}
