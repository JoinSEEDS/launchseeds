import { createLaunchseedsCoreServices } from "../services";
import { createSolardIntegrations } from "../integrations/solard";
import { ed25519VoteVerifier } from "../integrations/ed25519";
import { Store } from "./store";
import { openLaunchseedsData } from "../db";
import { LaunchService } from "./launch";
import { SolardLaunchProvider, SolardSource } from "./solard";
import { solToLamports } from "../shared/domain";
import { FreeLaunchService } from "./free-launch";
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
    openLaunchseedsData(process.env.LAUNCHSEEDS_DB_PATH || "./data/launchseeds-v3.sqlite"),
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
/** The sniper-protection bundle engine, when launches and bundles are on. */
export async function getBundleEngine() {
  return (await launchRuntime()).provider?.bundles ?? null;
}
/** Makes an agent wallet. Fails while launches run without a live provider. */
export async function createAgentWallet() {
  const { provider } = await launchRuntime();
  if (!provider) throw new Error("Launches are not enabled");
  return (slug: string) => provider.agentWallet(slug);
}
export async function getLaunchService() {
  return (await launchRuntime()).service;
}
let freeLaunch: FreeLaunchService | null | undefined;
/** Null when launches run without a live provider (tests, local read-only). */
export async function getFreeLaunchService() {
  if (freeLaunch !== undefined) return freeLaunch;
  const { provider } = await launchRuntime();
  return (freeLaunch = provider
    ? new FreeLaunchService(getStore(), provider)
    : null);
}

let core: ReturnType<typeof createLaunchseedsCoreServices> | undefined;
export const getCoreServices = () => {
  const store = getStore();
  return (core ??= createLaunchseedsCoreServices({
    repo: store.repo,
    ...createSolardIntegrations(store.repo),
    voteVerifier: ed25519VoteVerifier,
    chain: process.env.SOLANA_CHAIN || "solana:mainnet-beta",
    requireFreshSnapshot: true,
  }));
};
