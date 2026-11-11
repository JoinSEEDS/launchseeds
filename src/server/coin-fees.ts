/** Each coin's share of the treasury's creator fees. Pump keeps one creator
 * vault per creator, and the treasury creates every coin, so the vault mixes all
 * coins' fees. Each trade pays its coin's creator fee into the vault in the same
 * transaction, so the vault's balance increase in a coin's trade is that coin's fee. */
import { PublicKey } from "@solana/web3.js";
import type { LaunchseedsRepo } from "../db/repo";

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const creatorVault = (creator: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()], PUMP_PROGRAM)[0].toBase58();
export const bondingCurve = (mint: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0].toBase58();

export type FeeTransaction = {
  blockTime: number | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string } | string> } };
  meta: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
};

/** The coin's creator fee in one transaction: the vault's increase, when the
 * transaction trades on the coin's curve. Null when it is not such a trade. */
export function feeFromTransaction(tx: FeeTransaction, vault: string, curve: string): bigint | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  if (!keys.includes(curve)) return null;
  const i = keys.indexOf(vault);
  if (i < 0) return null;
  const delta = BigInt(tx.meta.postBalances[i]!) - BigInt(tx.meta.preBalances[i]!);
  return delta > 0n ? delta : null;
}

export type FeeRpc = <T>(method: string, params: unknown[]) => Promise<T>;
type Signature = { signature: string; err: unknown; blockTime?: number | null };

/** Records a coin's fees from trades newer than the last one counted. Reads at
 * most `maxTransactions` transactions a call, oldest first, so a busy coin
 * catches up over several worker cycles. Returns how many fees were recorded. */
export async function syncCoinFees(input: {
  repo: Pick<LaunchseedsRepo, "challenges">;
  rpc: FeeRpc;
  tokenId: number;
  mint: string;
  treasury: string;
  maxTransactions?: number;
}) {
  const curve = bondingCurve(input.mint), vault = creatorVault(input.treasury);
  const until = input.repo.challenges.latestFee(input.tokenId)?.signature;
  const fresh: Signature[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const batch = await input.rpc<Signature[]>("getSignaturesForAddress", [curve, { limit: 1000, commitment: "finalized", ...(until ? { until } : {}), ...(before ? { before } : {}) }]);
    fresh.push(...batch);
    if (batch.length < 1000) break;
    before = batch.at(-1)!.signature;
  }
  let recorded = 0;
  for (const s of fresh.reverse().filter((s) => !s.err).slice(0, input.maxTransactions ?? 100)) {
    const tx = await input.rpc<FeeTransaction | null>("getTransaction", [s.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 }]);
    if (!tx) break; // not served yet: retry from here next cycle
    const fee = feeFromTransaction(tx, vault, curve);
    // A trade without a fee still advances the cursor, recorded as zero.
    if (input.repo.challenges.recordFee(input.tokenId, s.signature, fee ?? 0n, (tx.blockTime ?? s.blockTime ?? 0) * 1000)) recorded++;
  }
  return recorded;
}
