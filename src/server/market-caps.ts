/** Each live coin's market cap, read from its pump curve and saved for its page
 * and card. A coin quoted in a pump coin (e.g. $SEEDS) is valued through that
 * coin's own curve, then the SOL price. Graduated coins are left as they are. */
import { PublicKey, type Connection } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import type { Store } from "./store";
import { isTreasury } from "./treasury";

const SOL_QUOTES = new Set([PublicKey.default.toBase58(), NATIVE_MINT.toBase58()]);
type Curve = { virtualTokenReserves: { toString(): string }; virtualQuoteReserves: { toString(): string }; tokenTotalSupply: { toString(): string }; complete: boolean; quoteMint: PublicKey };

/** Market cap in the quote's raw units: price (quote per raw token) times supply. */
export const curveMarketCap = (c: { virtualQuote: bigint; virtualToken: bigint; supply: bigint }) => Number(c.virtualQuote) * Number(c.supply) / Number(c.virtualToken);

export async function refreshMarketCaps(store: Store, connection: Connection, solUsd: () => Promise<number>) {
  const pump = await import("@pump-fun/pump-sdk");
  const sdk = new pump.OnlinePumpSdk(connection);
  const usd = await solUsd();
  // Lamports per raw unit of each quote coin, read once per refresh.
  const lamportsPerQuote = new Map<string, number>();
  const quotePrice = async (mint: PublicKey) => {
    const key = mint.toBase58();
    if (SOL_QUOTES.has(key)) return 1;
    if (!lamportsPerQuote.has(key)) {
      const q = (await sdk.fetchBondingCurve(mint)) as unknown as Curve;
      if (!SOL_QUOTES.has(q.quoteMint.toBase58())) throw new Error(`Quote ${key} is not SOL-quoted`);
      lamportsPerQuote.set(key, Number(q.virtualQuoteReserves.toString()) / Number(q.virtualTokenReserves.toString()));
    }
    return lamportsPerQuote.get(key)!;
  };
  let updated = 0;
  for (const token of store.listLive()) {
    if (!token.mint || !isTreasury(token.fundingWalletName)) continue;
    try {
      const curve = (await sdk.fetchBondingCurve(new PublicKey(token.mint))) as unknown as Curve;
      if (curve.complete) continue;
      const supply = BigInt(curve.tokenTotalSupply.toString());
      const capQuote = curveMarketCap({ virtualQuote: BigInt(curve.virtualQuoteReserves.toString()), virtualToken: BigInt(curve.virtualTokenReserves.toString()), supply });
      const marketCapUsd = (capQuote * (await quotePrice(curve.quoteMint))) / 1e9 * usd;
      if (!Number.isFinite(marketCapUsd) || marketCapUsd <= 0) continue;
      store.repo.tokens.setMarket(token.id, { marketCapUsd, priceUsd: marketCapUsd / (Number(supply) / 1e6) });
      updated++;
    } catch (error) {
      console.error(`Market cap ${token.mint}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return updated;
}
