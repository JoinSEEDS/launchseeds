/** Sets one vanity mint aside for $SEEDS, so its CA is known before launch.
 * Prints the CA; put it in `[launchseeds] seeds_reserved_mint`. Run once:
 *   bgrun-loaded env: bun run scripts/reserve-seeds-mint.ts */
import "../src/server/rpc-pacing-install";
import { getStore } from "../src/server/runtime";
import { SolardLaunchProvider } from "../src/server/solard";
import { seedsReservedMint } from "../src/domain/seeds-split";
import { solToLamports } from "../src/shared/domain";

if (seedsReservedMint()) throw new Error(`$SEEDS already has a reserved mint: ${seedsReservedMint()}`);
const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");
const provider = await SolardLaunchProvider.create(getStore(), rpcUrl, Number(solToLamports(process.env.LAUNCH_BASE_SOL || "0.001")));
const { mint } = provider.createMint();
if (!mint.endsWith("pump")) console.error("Warning: the vanity pool was empty; this is a random mint.");
console.log(mint);
process.exit(0);
