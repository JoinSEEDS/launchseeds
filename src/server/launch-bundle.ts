/** The launch bundle: the coin is created and first bought by its columns in one
 * Jito bundle, so nobody can buy before them. */
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
/** A v0 transaction's wire limit; Jito bundles take v0. */
export const V0_PACKET_LIMIT = 1232;

export function launchBundlesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.LAUNCHSEEDS_LAUNCH_BUNDLES === "true";
}

export const bundleWalletName = (mint: string, index: number) =>
  `launchseeds-bundle-${mint}-${index}`;

/** SOL the funding wallet needs beyond the base fee and the launch buy. */
export const bundleOverheadLamports = () =>
  BUNDLE_BUYERS * BUYER_RESERVE_LAMPORTS + JITO_TIP_LAMPORTS;

export const exitMinimum = (
  budgetLamports: bigint,
  bps: bigint = EXIT_MINIMUM_BPS,
) => (budgetLamports * bps + 9_999n) / 10_000n;

export type BundleBuyer = {
  /** User-funded launches: the column (buy transaction) this wallet buys in. */
  batchIndex?: number;
  /** User-funded launches: the post-launch tranche this wallet buys in instead. */
  tranche?: number;
  /** signer: a reused LaunchSeeds pool wallet that signs and pays its column's
   * transactions; fresh: a wallet generated for this launch only. */
  role?: "signer" | "fresh";
  name: string;
  wallet: string;
  budgetLamports: string;
};

/** Public part of a bundle launch intent (the signed bytes are never exposed). */
export type BundleIntent = {
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
