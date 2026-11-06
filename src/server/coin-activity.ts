/** A live coin's recent trades, read from its Pump bonding curve: each
 * transaction is fetched once and cached; a refresh only reads new signatures. */
import { PublicKey } from "@solana/web3.js";
import { rpcFetch } from "./rpc-pacing";
import { rpcUrlList } from "./rpc-urls";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const LIMIT = 40;
const REFRESH_MS = 8_000;
export type CoinTrade = { signature: string; at: number; side: "buy" | "sell"; sol: number; tokens: number; wallet: string };

type Cache = { at: number; trades: Map<string, CoinTrade | null>; order: string[]; pending: Promise<void> | null };
const caches = new Map<string, Cache>();

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const url of rpcUrlList(process.env.SOLANA_RPC_URL || "")) {
    try {
      const response = await rpcFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
      const body = (await response.json()) as { result?: T; error?: unknown };
      if (response.ok && !body.error && "result" in body) return body.result as T;
      last = body.error;
    } catch (error) { last = error; }
  }
  throw Error(`Activity ${method} unavailable${last instanceof Error ? `: ${last.message}` : ""}`);
}

type Parsed = {
  blockTime: number | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string; signer: boolean }> } };
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenRow[]; postTokenBalances?: TokenRow[] } | null;
};
type TokenRow = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };

function parseTrade(signature: string, tx: Parsed, mint: string, curve: string): CoinTrade | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const ci = keys.indexOf(curve);
  if (ci < 0) return null;
  const curveSol = (tx.meta.postBalances[ci]! - tx.meta.preBalances[ci]!) / 1e9;
  const amount = (rows: TokenRow[] = [], owner: string) => rows.filter((r) => r.mint === mint && r.owner === owner).reduce((s, r) => s + Number(r.uiTokenAmount.amount) / 10 ** r.uiTokenAmount.decimals, 0);
  const curveTokens = amount(tx.meta.postTokenBalances, curve) - amount(tx.meta.preTokenBalances, curve);
  if (Math.abs(curveTokens) < 1e-9 || Math.abs(curveSol) < 1e-9) return null;
  // The trader: the signer whose token balance moved opposite to the curve's.
  const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);
  const moved = (owner: string) => amount(tx.meta!.postTokenBalances, owner) - amount(tx.meta!.preTokenBalances, owner);
  const wallet = signers.find((s) => Math.abs(moved(s)) > 0) ?? signers[0] ?? keys[0]!;
  return { signature, at: (tx.blockTime ?? 0) * 1000, side: curveTokens < 0 ? "buy" : "sell", sol: Math.abs(curveSol), tokens: Math.abs(curveTokens), wallet };
}

export async function coinTrades(mint: string): Promise<CoinTrade[]> {
  const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
  let cache = caches.get(mint);
  if (!cache) caches.set(mint, (cache = { at: 0, trades: new Map(), order: [], pending: null }));
  const c = cache;
  if (Date.now() - c.at > REFRESH_MS && !c.pending) {
    c.pending = (async () => {
      const sigs = await rpc<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [curve, { limit: LIMIT, commitment: "confirmed" }]);
      for (const s of sigs) {
        if (c.trades.has(s.signature)) continue;
        if (s.err) { c.trades.set(s.signature, null); continue; }
        const tx = await rpc<Parsed | null>("getTransaction", [s.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
        if (tx) c.trades.set(s.signature, parseTrade(s.signature, tx, mint, curve));
      }
      c.order = sigs.map((s) => s.signature);
      c.at = Date.now();
    })().catch((error) => {
      // A background refresh has no caller to reject to, and an unhandled rejection
      // stops the server. Keep the last trades and wait a full interval to retry.
      c.at = Date.now();
      console.error("Coin activity refresh failed", error instanceof Error ? error.message : error);
    }).finally(() => { c.pending = null; });
  }
  if (c.pending && !c.order.length) await c.pending.catch(() => {});
  return c.order.map((s) => c.trades.get(s)).filter((t): t is CoinTrade => !!t);
}
