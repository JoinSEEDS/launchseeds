/** Built-in sniper protection: the coin is created and first bought in one Jito
 * bundle of four transactions, so no outside buyer can land between them.
 *
 *   1. the coin's new funding wallet creates the holder-reward coin (the creator
 *      buys nothing) and funds three new, public bundle wallets;
 *   2–4. each bundle wallet buys its share of the launch buy.
 *
 * The bundle wallets later sell together in one transaction, only when every
 * wallet gets back at least 102% of what it spent (see launch-bundle-exit.ts).
 * All bundle wallets are listed on the coin's page. */
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

export const BUNDLE_BUYERS = 3;
/** Left in each bundle wallet for its buy and the exit: fees and token-account rent. */
export const BUYER_RESERVE_LAMPORTS = 14_000_000;
export const JITO_TIP_LAMPORTS = 100_000;
/** Each wallet's exit minimum: 102% of its buy budget. */
export const EXIT_MINIMUM_BPS = 10_200n;
/** The smallest launch buy one bundle wallet makes. */
export const MIN_BUYER_LAMPORTS = 30_000_000;
/** v1 transactions hold up to 4096 bytes. */
export const V1_PACKET_LIMIT = 4096;

export function launchBundlesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.LAUNCHSEEDS_LAUNCH_BUNDLES === "true";
}

export const bundleWalletName = (mint: string, index: number) =>
  `launchseeds-bundle-${mint}-${index}`;

/** SOL the funding wallet needs beyond the base fee and the launch buy. */
export const bundleOverheadLamports = () =>
  BUNDLE_BUYERS * BUYER_RESERVE_LAMPORTS + JITO_TIP_LAMPORTS;

/** Splits the launch buy exactly; the first wallets take the remainder. */
export function splitBudget(
  totalLamports: bigint,
  buyers = BUNDLE_BUYERS,
): bigint[] {
  if (totalLamports < BigInt(MIN_BUYER_LAMPORTS) * BigInt(buyers))
    throw new Error(
      `Sniper protection needs at least ${(MIN_BUYER_LAMPORTS * buyers) / 1e9} SOL of launch buy`,
    );
  const base = totalLamports / BigInt(buyers);
  const rest = totalLamports - base * BigInt(buyers);
  return Array.from(
    { length: buyers },
    (_, i) => base + (BigInt(i) < rest ? 1n : 0n),
  );
}

export { allocatedBudget } from "../domain/protection-allocation";
export const exitMinimum = (
  budgetLamports: bigint,
  bps: bigint = EXIT_MINIMUM_BPS,
) => (budgetLamports * bps + 9_999n) / 10_000n;

export type BundleBuyer = {
  /** User-funded launches: the column (buy transaction) this wallet buys in. */
  batchIndex?: number;
  /** signer: a reused LaunchSeeds pool wallet that signs and pays its column's
   * transactions; fresh: a wallet generated for this launch only. */
  role?: "signer" | "fresh";
  name: string;
  wallet: string;
  budgetLamports: string;
};

/** Public part of a bundle launch intent (the signed bytes are never exposed). */
export type BundleIntent = {
  userFunded?: boolean;
  kind: "bundle";
  transactions: string[];
  signatures: string[];
  /** Creation's signature: the coin's deploy signature. */
  signature: string;
  mint: string;
  lastValidBlockHeight: number;
  buyers: BundleBuyer[];
  metadata: { name: string; symbol: string; uri: string };
  /** Creator fees to this wallet; absent: native Pump holder rewards. */
  feesTo?: string;
  /** LaunchSeeds's capital wallet that funded the bundle wallets. */
  capitalWallet?: string;
  /** The coin's funding (dev) wallet that signs creation. */
  fundingWallet?: string;
  superseded?: unknown[];
};

export function parseBundleIntent(
  intent: string | null | undefined,
): BundleIntent | null {
  if (!intent) return null;
  try {
    const value = JSON.parse(intent) as Partial<BundleIntent>;
    return value.kind === "bundle" && Array.isArray(value.buyers)
      ? (value as BundleIntent)
      : null;
  } catch {
    return null;
  }
}

/** The creation transaction's funding transfers to the bundle wallets. */
export function fundBuyers(
  funding: PublicKey,
  buyers: Array<{ wallet: string; budgetLamports: bigint }>,
): TransactionInstruction[] {
  return buyers.map((b) =>
    SystemProgram.transfer({
      fromPubkey: funding,
      toPubkey: new PublicKey(b.wallet),
      lamports: b.budgetLamports + BigInt(BUYER_RESERVE_LAMPORTS),
    }),
  );
}
