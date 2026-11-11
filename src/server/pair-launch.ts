/** Launches paired with a pump coin (LaunchSeeds pairs every coin with $SEEDS
 * when `[launchseeds] pair_mint` is set). The coin is created quoted in that
 * coin, and each bundle wallet buys with one pump multi-hop swap, SOL -> pair
 * coin -> new coin, from its SOL budget. */
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

/** The coin every launch is paired with, or null for SOL. */
export const pairMint = (env: Record<string, string | undefined> = process.env) => {
  const value = env.LAUNCHSEEDS_PAIR_MINT?.trim();
  return value && value.toUpperCase() !== "SOL" ? value : null;
};

export type ResolvedPair = {
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  /** Accounts create_v2 needs for a pump-coin quote. */
  pumpQuote: unknown;
  /** Virtual quote reserves a new coin's curve starts with, in the pair coin's raw units. */
  initialVirtualQuote: bigint;
  initialVirtualBase: bigint;
  /** The pair coin's own curve now: SOL in lamports, tokens raw. */
  pairCurve: { virtualSol: bigint; virtualToken: bigint };
};

type Pump = typeof import("@pump-fun/pump-sdk");

/** Pump's own admission check: throws when the pair coin can't be a quote now
 * (mayhem, awaiting migration, too deep). */
export async function resolvePair(pump: Pump, connection: Connection, mint: string): Promise<ResolvedPair> {
  const sdk = new pump.OnlinePumpSdk(connection);
  const key = new PublicKey(mint);
  const resolved = await sdk.resolveQuoteMint(key);
  if (resolved.source !== "pumpCoin" || !resolved.pumpQuote) throw new Error("The pair must be a pump coin");
  const [global, curve] = await Promise.all([sdk.fetchGlobal(), sdk.fetchBondingCurve(key)]);
  if (curve.complete) throw new Error("The pair coin has left its curve; pool routes are not supported yet");
  return {
    mint: resolved.mint,
    tokenProgram: resolved.quoteTokenProgram,
    decimals: resolved.decimals,
    pumpQuote: resolved.pumpQuote.accounts,
    initialVirtualQuote: BigInt(resolved.initialVirtualQuoteReserves.toString()),
    initialVirtualBase: BigInt(global.initialVirtualTokenReserves.toString()),
    pairCurve: { virtualSol: BigInt(curve.virtualQuoteReserves.toString()), virtualToken: BigInt(curve.virtualTokenReserves.toString()) },
  };
}

/** Constant-product output for `amountIn` (no fees: the minimums below are loose). */
const out = (inReserve: bigint, outReserve: bigint, amountIn: bigint) => (outReserve * amountIn) / (inReserve + amountIn);

/** Each buyer's minimum new-coin output, walking both curves in bundle order.
 * Half the fee-less estimate: the bundle is atomic, so this only guards against
 * the pair coin's price moving a lot before it lands. */
export function pairedBuyMinimums(pair: Pick<ResolvedPair, "pairCurve" | "initialVirtualQuote" | "initialVirtualBase">, budgets: bigint[]) {
  let sol = pair.pairCurve.virtualSol, pairTokens = pair.pairCurve.virtualToken;
  let quote = pair.initialVirtualQuote, base = pair.initialVirtualBase;
  return budgets.map((lamports) => {
    const pairOut = out(sol, pairTokens, lamports);
    sol += lamports; pairTokens -= pairOut;
    const coinOut = out(quote, base, pairOut);
    quote += pairOut; base -= coinOut;
    return coinOut / 2n;
  });
}

/** create_v2 quoted in the pair coin. */
export function pairedCreateInstruction(pump: Pump, pair: ResolvedPair, args: { mint: PublicKey; user: PublicKey; creator: PublicKey; name: string; symbol: string; uri: string }) {
  return pump.PUMP_SDK.createV2Instruction({
    ...args,
    mayhemMode: false,
    cashback: false,
    holderReward: false,
    quoteMint: pair.mint,
    quoteTokenProgram: pair.tokenProgram,
    pumpQuote: pair.pumpQuote as never,
  });
}

/** One wallet's buy: SOL -> pair coin -> new coin, exact SOL in. */
export function pairedBuyInstructions(pump: Pump, pair: ResolvedPair, args: { buyer: PublicKey; coin: PublicKey; lamports: bigint; minimumOut: bigint }): Promise<TransactionInstruction[]> {
  return pump.PUMP_SDK.multiHopSwapInstructions({
    user: args.buyer,
    side: "buy",
    amountIn: new BN(args.lamports.toString()),
    minAmountOut: new BN(args.minimumOut.toString()),
    hops: [
      { venue: "curve", baseMint: pair.mint, quoteMint: NATIVE_MINT, baseTokenProgram: pair.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID },
      { venue: "curve", baseMint: args.coin, quoteMint: pair.mint, baseTokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: pair.tokenProgram },
    ],
  });
}
