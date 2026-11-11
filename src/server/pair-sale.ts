/** Selling a coin paired with a pump coin (e.g. $SEEDS): one pump multi-hop
 * swap, coin -> pair coin -> SOL, exact tokens in, refusing less than a SOL
 * minimum. Market cap floors are judged on the coin's own curve in the pair
 * coin's units, then carried to SOL through the pair coin's curve. */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { floorSaleMinimum, postBundleMarketCapLamports } from "../domain/user-funded-batches";

/** Pump's fee on a sell, taken from the output. */
const SELL_FEE_BPS = 125n;
const afterFee = (amount: bigint) => (amount * (10_000n - SELL_FEE_BPS)) / 10_000n;
/** Constant-product output for `amountIn`. */
const out = (inReserve: bigint, outReserve: bigint, amountIn: bigint) => (outReserve * amountIn) / (inReserve + amountIn);

export type PairedSaleInput = {
  /** The coin's curve, quoted in the pair coin (raw units). */
  coin: { virtualBase: bigint; virtualQuote: bigint; supply: bigint };
  /** The pair coin's curve against SOL. */
  pair: { virtualSol: bigint; virtualToken: bigint };
  sellRaw: bigint;
  /** A SOL minimum of its own (profit target). */
  requiredLamports: bigint | null;
  /** USD market cap floor, with the SOL price. */
  floorUsd?: number;
  solUsd?: number;
  /** Post-bundle hold: the tokens the launch bundle bought. */
  afterBundleRaw?: bigint;
};

/** The SOL the sale must return, or null when a floor can't be cleared with this sale. */
export function pairedSaleMinimum(input: PairedSaleInput): bigint | null {
  const { coin, pair } = input;
  const pairToSol = (pairRaw: bigint) => afterFee(out(pair.virtualToken, pair.virtualSol, pairRaw));
  const expected = pairToSol(afterFee(out(coin.virtualBase, coin.virtualQuote, input.sellRaw)));
  let minimum = (expected * 9n) / 10n; // at market: within 10% of the quote
  if (input.requiredLamports !== null && input.requiredLamports > minimum) minimum = input.requiredLamports;
  if (input.floorUsd !== undefined || input.afterBundleRaw !== undefined) {
    // The floor as a market cap in the pair coin's raw units.
    const floorQuote = input.afterBundleRaw !== undefined
      ? postBundleMarketCapLamports({ virtualQuote: coin.virtualQuote, virtualBase: coin.virtualBase, supply: coin.supply, bundleRaw: input.afterBundleRaw })
      : ((input.floorUsd! / input.solUsd!) * 1e9 * Number(pair.virtualToken)) / Number(pair.virtualSol);
    const minimumQuote = floorSaleMinimum({ virtualQuote: coin.virtualQuote, virtualBase: coin.virtualBase, supply: coin.supply, sellRaw: input.sellRaw, floorLamports: floorQuote });
    if (minimumQuote === null) return null;
    const floorSol = pairToSol(minimumQuote);
    if (floorSol > minimum) minimum = floorSol;
  }
  return minimum;
}

type Pump = typeof import("@pump-fun/pump-sdk");
/** The swap: coin -> pair coin -> SOL, from `seller`, exact `sellRaw` in. */
export function pairedSellInstructions(pump: Pump, args: { seller: PublicKey; coin: PublicKey; pair: PublicKey; pairTokenProgram: PublicKey; sellRaw: bigint; minimumLamports: bigint }): Promise<TransactionInstruction[]> {
  return pump.PUMP_SDK.multiHopSwapInstructions({
    user: args.seller,
    side: "sell",
    amountIn: new BN(args.sellRaw.toString()),
    minAmountOut: new BN(args.minimumLamports.toString()),
    hops: [
      // A sell walks the chain down: the SOL leg comes last.
      { venue: "curve", baseMint: args.coin, quoteMint: args.pair, baseTokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: args.pairTokenProgram },
      { venue: "curve", baseMint: args.pair, quoteMint: NATIVE_MINT, baseTokenProgram: args.pairTokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID },
    ],
  });
}
