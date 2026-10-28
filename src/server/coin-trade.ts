/** Coin-page trading: an unsigned Pump bonding-curve buy or sell for the
 * visitor's own wallet, quoted and simulated here, signed and sent by the
 * wallet. LaunchSeeds never holds the visitor's keys or funds. A coin that has
 * graduated to PumpSwap trades on pump.fun instead. */
import {
  ComputeBudgetProgram, PublicKey, Transaction, type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export const MAX_TRADE_LAMPORTS = 100_000_000_000n;
export const TRADE_SLIPPAGE_PERCENTS = [1, 2, 5, 10, 20] as const;
const PRIORITY_MICRO_LAMPORTS = 100_000;
const COMPUTE_UNITS = 200_000;

export type TradeRequest =
  | { side: "buy"; wallet: string; mint: string; lamports: bigint; slippagePercent: number }
  | { side: "sell"; wallet: string; mint: string; percent: number; slippagePercent: number };

export type TradeQuote = {
  /** Unsigned legacy transaction (base64), fee payer = the wallet. */
  transaction: string;
  side: "buy" | "sell";
  /** buy: SOL in; sell: SOL out (expected, before slippage). */
  lamports: string;
  /** buy: tokens out (expected); sell: tokens in. Raw units. */
  tokensRaw: string;
  /** The worst case the transaction accepts. */
  limitLamports: string;
  decimals: number;
};

export class TradeError extends Error {}

export async function prepareTrade(connection: Connection, request: TradeRequest): Promise<TradeQuote> {
  const pump = await import("@pump-fun/pump-sdk");
  const BN = (await import("bn.js")).default;
  const user = new PublicKey(request.wallet);
  const mint = new PublicKey(request.mint);
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount) throw new TradeError("Coin not found on chain.");
  const tokenProgram = mintAccount.owner;
  const decimals = mintAccount.data.readUInt8(44);
  const online = new pump.OnlinePumpSdk(connection);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  const slippage = request.slippagePercent;
  let instructions: TransactionInstruction[];
  let lamports: bigint, tokensRaw: bigint, limitLamports: bigint;

  if (request.side === "buy") {
    if (request.lamports <= 0n || request.lamports > MAX_TRADE_LAMPORTS) throw new TradeError("Enter an amount of SOL to buy.");
    const state = await online.fetchBuyState(mint, user, tokenProgram);
    if (state.bondingCurve.complete) throw new TradeError("This coin has graduated: trade it on pump.fun.");
    const solAmount = new BN(request.lamports.toString());
    const amount = pump.getBuyTokenAmountFromSolAmount({
      global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve,
      amount: solAmount, quoteMint: state.quoteMint,
    });
    if (amount.isZero()) throw new TradeError("That buy is too small.");
    instructions = await pump.PUMP_SDK.buyInstructions({
      global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo, mint, user, amount, solAmount, slippage, tokenProgram,
    });
    lamports = request.lamports;
    tokensRaw = BigInt(amount.toString());
    limitLamports = request.lamports + (request.lamports * BigInt(Math.floor(slippage * 10))) / 1000n;
  } else {
    if (!(request.percent > 0 && request.percent <= 100)) throw new TradeError("Choose how much to sell.");
    const account = getAssociatedTokenAddressSync(mint, user, true, tokenProgram);
    const balance = await connection.getTokenAccountBalance(account, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n);
    const amountRaw = (balance * BigInt(Math.round(request.percent * 100))) / 10_000n;
    if (amountRaw <= 0n) throw new TradeError("This wallet holds none of this coin.");
    const state = await online.fetchSellState(mint, user, tokenProgram);
    if (state.bondingCurve.complete) throw new TradeError("This coin has graduated: trade it on pump.fun.");
    const amount = new BN(amountRaw.toString());
    const solAmount = pump.getSellSolAmountFromTokenAmount({
      global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount,
    });
    instructions = await pump.PUMP_SDK.sellInstructions({
      global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
      mint, user, amount, solAmount, slippage, tokenProgram,
      mayhemMode: state.bondingCurve.isMayhemMode, cashback: state.bondingCurve.isCashbackCoin,
    });
    lamports = BigInt(solAmount.toString());
    tokensRaw = amountRaw;
    limitLamports = lamports - (lamports * BigInt(Math.floor(slippage * 10))) / 1000n;
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: user, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    ...instructions,
  );
  // Unsigned simulation: a buy the wallet cannot afford fails here, not in the wallet.
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) throw new TradeError(simulationProblem(simulation.value.err, simulation.value.logs ?? []));
  return {
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    side: request.side,
    lamports: lamports.toString(),
    tokensRaw: tokensRaw.toString(),
    limitLamports: limitLamports.toString(),
    decimals,
  };
}

/** A visitor-facing reason for a failed simulation. */
export function simulationProblem(err: unknown, logs: string[]): string {
  const text = `${JSON.stringify(err)} ${logs.join(" ")}`;
  if (/insufficient lamports|InsufficientFundsForRent|"InsufficientFunds"|0x1\b/i.test(text)) return "Not enough SOL in this wallet for that trade and its fees.";
  if (/TooMuchSolRequired|TooLittleSolReceived|6002|6003/.test(text)) return "The price moved past your slippage. Try again or raise the slippage.";
  if (/AccountNotFound/.test(text)) return "This wallet has no SOL yet.";
  return "The trade would fail right now. Try a different amount.";
}
