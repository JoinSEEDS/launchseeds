/** Solard wiring for the sniper-protection launch bundle (launch-bundle.ts):
 * builds, simulates and signs the four transactions, persists them as the launch
 * intent, submits them as one Jito bundle and reconciles their signatures. */
import {
  Connection,
  PublicKey,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  BUNDLE_BUYERS,
  JITO_TIP_LAMPORTS,
  V1_PACKET_LIMIT,
  bundleWalletName,
  fundBuyers,
  splitBudget,
  allocatedBudget,
  type BundleBuyer,
  type BundleIntent,
} from "./launch-bundle";
import { loadWireTransaction } from "./solard-sdk";
import { rpcFetch } from "./rpc-pacing";

type Draft = {
  instructions: TransactionInstruction[];
  signers: Keypair[];
  actions: unknown[];
  trackedAccounts: unknown[];
};
type Planned = {
  transaction: { signatures: Uint8Array[]; serialize(): Uint8Array };
  lastValidBlockHeight: number;
};
/** The parts of Solard's trader preset (0.2.42, transactionVersion 1) used here. */
export type BundleTrader = {
  initialPendingMarketState(
    launchpad: "pump",
    deployment: unknown,
  ): Promise<unknown>;
  preparePendingBuy(
    launchpad: "pump",
    deployment: unknown,
    buyer: string,
    amount: unknown,
    state: unknown,
    options: { slippageBps: number },
  ): Promise<{
    instructions: TransactionInstruction[];
    expectedOutputRaw: bigint;
    minimumOutputRaw: bigint;
    nextState: unknown;
  }>;
  compileGroups(
    groups: Array<{
      payer: string;
      additionalWallets?: string[];
      drafts: Draft[];
      cuLimit?: number;
      priorityMicroLamports?: number;
    }>,
  ): Promise<Planned[]>;
  prepareUnsignedSell(args: {
    payer: string;
    mint: string;
    amountRaw: bigint;
    slippageBps: number;
    minOutputLamports?: bigint;
  }): Promise<{ draft: Draft }>;
  signer(wallet: string): Keypair;
};
type Core = {
  SOL_ASSET: unknown;
  rawAmount(raw: bigint, asset: unknown): unknown;
  getJitoTipAccounts(endpoint?: string): Promise<string[]>;
  JitoSender: new (endpoint?: string) => {
    sendBundle(args: {
      connection: Connection;
      transactions: unknown[];
    }): Promise<{ submissionId: string }>;
  };
};
export async function loadCore() {
  const name: string = "@solard/core";
  return (await import(name)) as Core;
}

type Wire = Awaited<ReturnType<typeof loadWireTransaction>>;
export type BundleContext = {
  connection: Connection;
  rpcUrl: string;
  trader: BundleTrader;
  wallet(name: string): { address: string };
  /** Solard modules matching `trader` (default: the installed package). */
  core?: Core;
  wire?: Wire;
};
const coreOf = async (ctx: BundleContext) => ctx.core ?? (await loadCore());
const wireOf = async (ctx: BundleContext) =>
  ctx.wire ?? (await loadWireTransaction());

const draft = (
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): Draft => ({ instructions, signers, actions: [], trackedAccounts: [] });

/** Signed simulation of raw bytes (any wire version); the error text, or null. */
export async function simulateRaw(
  rpcUrl: string,
  bytes: Uint8Array,
  sigVerify: boolean,
): Promise<string | null> {
  let response: Response;
  try {
    response = await rpcFetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          Buffer.from(bytes).toString("base64"),
          {
            encoding: "base64",
            sigVerify,
            replaceRecentBlockhash: !sigVerify,
            commitment: "confirmed",
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    // Network failures (reset sockets, timeouts) are transient: report, don't throw.
    return `RPC_UNAVAILABLE network ${error instanceof Error ? ((error as { code?: string }).code ?? error.name) : "error"}`;
  }
  // A rate-limited or failing provider can answer with plain text: report it, don't throw.
  const text = await response.text();
  let body: {
    error?: { message?: string };
    result?: { value?: { err: unknown; logs?: string[] } };
  };
  try {
    body = JSON.parse(text);
  } catch {
    return `RPC_UNAVAILABLE ${response.status} ${text.slice(0, 80)}`;
  }
  if (body.error) return body.error.message ?? "RPC error";
  const value = body.result?.value;
  if (!value) return "No simulation result";
  return value.err
    ? `${JSON.stringify(value.err)} ${(value.logs ?? []).slice(-4).join(" | ")}`
    : null;
}

export async function prepareBundle(
  ctx: BundleContext,
  input: {
    fundingWallet: string;
    mint: string;
    metadata: { name: string; symbol: string; uri: string };
    devBuyLamports: number;
    walletSharesBps?: readonly number[];
    /** Dry run: simulate with this funded address as the creator and stop (nothing is signed). */
    simulateAs?: string;
    /** Wallets that buy with their own SOL (LaunchSeeds's rotating slots); otherwise
     * new bundle wallets are funded from the launch's funding wallet. */
    buyers?: BundleBuyer[];
    /** Creator-fee recipient instead of holder rewards (e.g. the owner wallet). */
    feesTo?: string;
    /** Funds the bundle wallets (co-signs creation) instead of the funding wallet. */
    capitalWallet?: string;
    userFunded?: boolean;
  },
): Promise<BundleIntent> {
  const pump = await import("@pump-fun/pump-sdk");
  const core = await coreOf(ctx);
  const mint = new PublicKey(input.mint);
  const funding = new PublicKey(input.simulateAs ?? input.fundingWallet);
  const global = await new pump.OnlinePumpSdk(ctx.connection).fetchGlobal();
  const feesTo = input.feesTo ? new PublicKey(input.feesTo) : null;
  if (!feesTo && !global.isHolderRewardEnabled)
    throw new Error("Pump holder-reward coins are disabled right now");

  const buyers: BundleBuyer[] =
    input.buyers ??
    (input.walletSharesBps
      ? allocatedBudget(BigInt(input.devBuyLamports), input.walletSharesBps)
      : splitBudget(BigInt(input.devBuyLamports))
    ).map((budget, i) => {
      const name = bundleWalletName(input.mint, i);
      return {
        name,
        wallet: ctx.wallet(name).address,
        budgetLamports: budget.toString(),
      };
    });
  const mintSigner = ctx.trader.signer(input.mint);
  const create = await pump.PUMP_SDK.createV2Instruction({
    mint,
    user: funding,
    creator: feesTo ?? funding,
    ...input.metadata,
    mayhemMode: false,
    cashback: false,
    holderReward: !feesTo,
  });
  // Solard quotes each buy against the curve left by the ones before it. A
  // holder-reward coin's effective creator is its holder-rewards PDA.
  const deployment = {
    launchpad: "pump",
    mint: mintSigner,
    user: funding,
    creator: feesTo ?? pump.holderRewardsPda(mint),
    quoteAsset: core.SOL_ASSET,
    token: {
      mint: input.mint,
      name: input.metadata.name,
      symbol: input.metadata.symbol,
    },
    instructions: [create],
    signers: [mintSigner],
    metadata: { mayhemMode: false },
  };
  let state = await ctx.trader.initialPendingMarketState("pump", deployment);
  const buys: TransactionInstruction[][] = [];
  for (const buyer of buyers) {
    const buy = await ctx.trader.preparePendingBuy(
      "pump",
      deployment,
      buyer.wallet,
      core.rawAmount(BigInt(buyer.budgetLamports), core.SOL_ASSET),
      state,
      { slippageBps: 500 },
    );
    state = buy.nextState; // sequential: each buy moves the curve for the next
    buys.push(buy.instructions);
  }
  const funder = input.capitalWallet
    ? new PublicKey(input.capitalWallet)
    : funding;
  const creation =
    input.buyers && !input.capitalWallet && !input.userFunded
      ? [create]
      : [
          create,
          ...fundBuyers(
            funder,
            buyers.map((b) => ({
              wallet: b.wallet,
              budgetLamports: BigInt(b.budgetLamports),
            })),
          ),
        ];

  // Legacy's three buys fit a single-bank check. A grouped launch can exceed
  // one transaction's limits while fitting its four actual bundle transactions.
  // Its cumulative quotes and actual compiled groups are checked below; Jito
  // validates the complete bundle before inclusion.
  if (!input.userFunded) {
    const { buildV1Transaction } = await wireOf(ctx);
    const latest = await ctx.connection.getLatestBlockhash("confirmed");
    const combined = await buildV1Transaction(funding,{...draft([...creation,...buys.flat()]),cuLimit:1_400_000} as never,latest.blockhash,latest.lastValidBlockHeight);
    const problem=await simulateRaw(ctx.rpcUrl,combined.serialize(),false);
    if(problem)throw new Error(`Launch bundle simulation failed: ${problem}`);
    if(input.simulateAs)throw new Error(`DRY-RUN-OK: create + ${buyers.length} buys simulated (${combined.serialize().length} bytes combined)`);
  } else if(input.simulateAs)throw Error("Grouped validation must use the published funding and buyer addresses");

  const tips = await core.getJitoTipAccounts();
  const tip = new PublicKey(tips[Math.floor(Math.random() * tips.length)]!);
  const { SystemProgram } = await import("@solana/web3.js");
  // User-funded: one transaction per column, signed and paid by the column's
  // signer (its first slot) with the column's fresh wallets co-signing.
  const columns = [...new Set(buyers.map((buyer) => buyer.batchIndex ?? 0))].sort((a, b) => a - b);
  const groups = input.userFunded
    ? columns.map((batchIndex) => buyers.map((buyer, index) => ({ buyer, index })).filter((entry) => entry.buyer.batchIndex === batchIndex)
        .sort((a, b) => Number(b.buyer.role === "signer") - Number(a.buyer.role === "signer")))
    : buyers.map((buyer, index) => [{ buyer, index }]);
  if (groups.some((group) => !group.length)) throw Error("Every launch column needs a buyer");
  if (input.userFunded && (groups.length > 4 || columns.some((c, i) => c !== i))) throw Error("A launch has one to four consecutive columns");
  const last = groups.length - 1;
  const planned = await ctx.trader.compileGroups([
    {
      payer: input.fundingWallet,
      ...(input.capitalWallet
        ? { additionalWallets: [input.capitalWallet] }
        : {}),
      drafts: [draft(creation, [mintSigner])],
      cuLimit: 400_000,
      priorityMicroLamports: 0,
    },
    ...groups.map((group, i) => ({
      payer: group[0]!.buyer.wallet,
      additionalWallets: group.slice(1).map(entry=>entry.buyer.wallet),
      drafts: [
        ...group.map(entry=>draft(buys[entry.index]!)),
        ...(i === last
          ? [
              draft([
                SystemProgram.transfer({
                  fromPubkey: new PublicKey(group[0]!.buyer.wallet),
                  toPubkey: tip,
                  lamports: JITO_TIP_LAMPORTS,
                }),
              ]),
            ]
          : []),
      ],
      cuLimit: input.userFunded ? 1_200_000 : 300_000,
      priorityMicroLamports: 0,
    })),
  ]);
  if (planned.length !== groups.length + 1 || planned.length > 5)
    throw new Error("Launch does not fit one Jito bundle");
  const transactions = planned.map((p) => p.transaction.serialize());
  for (const bytes of transactions)
    if (bytes.length > V1_PACKET_LIMIT)
      throw new Error(`Launch transaction too large (${bytes.length} bytes)`);
  const signatures = planned.map((p) =>
    bs58.encode(p.transaction.signatures[0]!),
  );
  return {
    ...(input.userFunded ? {userFunded:true} : {}),
    kind: "bundle",
    ...(input.feesTo ? { feesTo: input.feesTo } : {}),
    ...(input.capitalWallet ? { capitalWallet: input.capitalWallet } : {}),
    fundingWallet: input.fundingWallet,
    transactions: transactions.map((b) => Buffer.from(b).toString("base64")),
    signatures,
    signature: signatures[0]!,
    mint: input.mint,
    lastValidBlockHeight: Math.min(
      ...planned.map((p) => p.lastValidBlockHeight),
    ),
    buyers,
    metadata: input.metadata,
  };
}

/** Confirmed once every transaction landed; expired only when none can land. */
export async function executeBundle(ctx: BundleContext, plan: BundleIntent) {
  const { deserializeWireTransaction } = await wireOf(ctx);
  const transactions = plan.transactions.map((t) =>
    deserializeWireTransaction(Buffer.from(t, "base64")),
  );
  transactions.forEach((tx, i) => {
    if (bs58.encode(tx.signatures[0]!) !== plan.signatures[i])
      throw new Error("Persisted launch signature mismatch");
  });
  const statuses = (
    await ctx.connection.getSignatureStatuses(plan.signatures, {
      searchTransactionHistory: true,
    })
  ).value;
  if (statuses.some((s) => s?.err))
    throw new Error(
      "A launch bundle transaction failed; reconciliation required",
    );
  const landed = statuses.filter(
    (s) =>
      s?.confirmationStatus === "confirmed" ||
      s?.confirmationStatus === "finalized",
  ).length;
  const result = { signature: plan.signature, mint: plan.mint };
  if (landed === statuses.length)
    return { status: "confirmed" as const, ...result };
  if (landed > 0) return { status: "pending" as const, ...result };
  if (
    (await ctx.connection.getBlockHeight("finalized")) >
    plan.lastValidBlockHeight
  ) {
    if (statuses.some(Boolean))
      throw new Error("Launch outcome is unresolved; reconciliation required");
    return { status: "expired" as const, ...result };
  }
  const core = await coreOf(ctx);
  await new core.JitoSender().sendBundle({
    connection: ctx.connection,
    transactions,
  });
  return { status: "pending" as const, ...result };
}

/** A fresh bundle with the same mint and wallets, only once the old one provably cannot land. */
export async function refreshBundle(
  ctx: BundleContext,
  plan: BundleIntent,
  fundingWallet: string,
  devBuyLamports: number,
  ownFunds = false,
) {
  if (
    (await ctx.connection.getBlockHeight("finalized")) <=
    plan.lastValidBlockHeight
  )
    throw new Error("Launch bundle is not conclusively expired");
  const statuses = (
    await ctx.connection.getSignatureStatuses(plan.signatures, {
      searchTransactionHistory: true,
    })
  ).value;
  if (
    statuses.some(Boolean) ||
    (await ctx.connection.getAccountInfo(new PublicKey(plan.mint), "confirmed"))
  )
    throw new Error(
      "Launch has an observed chain outcome; reconciliation required",
    );
  const { superseded = [], transactions: _bytes, ...previous } = plan;
  const fresh = await prepareBundle(ctx, {
    fundingWallet,
    mint: plan.mint,
    metadata: plan.metadata,
    devBuyLamports,
    ...(ownFunds || plan.capitalWallet || plan.userFunded ? { buyers: plan.buyers } : {}),
    ...(plan.userFunded ? {userFunded:true} : {}),
    ...(plan.feesTo ? { feesTo: plan.feesTo } : {}),
    ...(plan.capitalWallet ? { capitalWallet: plan.capitalWallet } : {}),
  });
  return {
    ...fresh,
    superseded: [...superseded, { ...previous, transactions: [] }],
  };
}

/** Each bundle wallet's confirmed fill: its token delta in its own buy transaction. */
export async function confirmedFills(
  ctx: BundleContext,
  plan: Pick<BundleIntent, "mint" | "buyers" | "signatures">,
): Promise<bigint[]> {
  return await Promise.all(
    plan.buyers.map(async (buyer, i) => {
      const signature = plan.signatures[(buyer.batchIndex ?? i) + 1]!;
      const body = (await (
        await rpcFetch(ctx.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [
              signature,
              {
                encoding: "json",
                commitment: "confirmed",
                maxSupportedTransactionVersion: 1,
              },
            ],
          }),
          signal: AbortSignal.timeout(10000),
        })
      ).json()) as {
        result?: {
          meta?: {
            err: unknown;
            preTokenBalances?: TokenBalance[];
            postTokenBalances?: TokenBalance[];
          };
        } | null;
      };
      const meta = body.result?.meta;
      if (!meta || meta.err)
        throw new Error(`Buy ${signature} is not confirmed without error`);
      const amount = (rows: TokenBalance[] = []) =>
        BigInt(
          rows.find((r) => r.mint === plan.mint && r.owner === buyer.wallet)
            ?.uiTokenAmount.amount ?? "0",
        );
      const fill =
        amount(meta.postTokenBalances) - amount(meta.preTokenBalances);
      if (fill <= 0n)
        throw new Error(`No fill for ${buyer.wallet} in ${signature}`);
      return fill;
    }),
  );
}
type TokenBalance = {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

export type PreparedExit = {
  transaction: string;
  signature: string;
  lastValidBlockHeight: number;
};

/** One transaction selling every bundle wallet's exact fill, each with its own
 * minimum of 110% of its buy budget. `problem` is set when it cannot execute now
 * (Pump 6003 TooLittleSolReceived: a wallet is not up 10% yet). */
export async function prepareExit(
  ctx: BundleContext,
  plan: Pick<BundleIntent, "mint" | "buyers">,
  fills: bigint[],
  /** "profit": each wallet needs 110% of its buy; "market": Solard's quoted minimum (rotation). */
  kind: "profit" | "market" = "profit",
): Promise<{ exit: PreparedExit; problem: string | null }> {
  const { exitMinimum } = await import("./launch-bundle");
  const drafts: Draft[] = [];
  for (const [i, buyer] of plan.buyers.entries()) {
    const sell = await ctx.trader.prepareUnsignedSell({
      payer: buyer.wallet,
      mint: plan.mint,
      amountRaw: fills[i]!,
      slippageBps: kind === "profit" ? 500 : 1_000,
      ...(kind === "profit"
        ? { minOutputLamports: exitMinimum(BigInt(buyer.budgetLamports)) }
        : {}),
    } as Parameters<BundleTrader["prepareUnsignedSell"]>[0]);
    drafts.push(sell.draft);
  }
  const [planned] = await ctx.trader.compileGroups([
    {
      payer: plan.buyers[0]!.wallet,
      additionalWallets: plan.buyers.slice(1).map((b) => b.wallet),
      drafts,
      cuLimit: 500_000,
      priorityMicroLamports: 10_000,
    },
  ]);
  const bytes = planned!.transaction.serialize();
  return {
    exit: {
      transaction: Buffer.from(bytes).toString("base64"),
      signature: bs58.encode(planned!.transaction.signatures[0]!),
      lastValidBlockHeight: planned!.lastValidBlockHeight,
    },
    problem: await simulateRaw(ctx.rpcUrl, bytes, true),
  };
}

/** The exit, signed ahead of time with Pump's own sell instruction: each wallet
 * sells its exact fill with a minimum of 110% of its buy, whatever the price is
 * now. It only executes once the market pays that; until then it is simulated
 * (free) and kept ready, and rebuilt when its blockhash ages out. */
export async function prepareFixedExit(
  ctx: BundleContext,
  plan: Pick<BundleIntent, "mint" | "buyers">,
  fills: bigint[],
  bps?: bigint,
): Promise<PreparedExit> {
  const pump = await import("@pump-fun/pump-sdk");
  const { TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
  const BN = (await import("bn.js")).default;
  const { exitMinimum } = await import("./launch-bundle");
  const online = new pump.OnlinePumpSdk(ctx.connection);
  const global = await online.fetchGlobal();
  const mint = new PublicKey(plan.mint);
  const drafts: Draft[] = [];
  for (const [i, buyer] of plan.buyers.entries()) {
    const user = new PublicKey(buyer.wallet);
    const state = await online.fetchSellState(
      mint,
      user,
      TOKEN_2022_PROGRAM_ID,
    );
    drafts.push(
      draft(
        await pump.PUMP_SDK.sellInstructions({
          global,
          bondingCurveAccountInfo: state.bondingCurveAccountInfo,
          bondingCurve: state.bondingCurve,
          mint,
          user,
          amount: new BN(fills[i]!.toString()),
          solAmount: new BN(
            exitMinimum(BigInt(buyer.budgetLamports), bps).toString(),
          ),
          slippage: 0,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          mayhemMode: false,
        }),
      ),
    );
  }
  const [planned] = await ctx.trader.compileGroups([
    {
      payer: plan.buyers[0]!.wallet,
      additionalWallets: plan.buyers.slice(1).map((b) => b.wallet),
      drafts,
      cuLimit: 400_000,
      priorityMicroLamports: 50_000,
    },
  ]);
  return {
    transaction: Buffer.from(planned!.transaction.serialize()).toString(
      "base64",
    ),
    signature: bs58.encode(planned!.transaction.signatures[0]!),
    lastValidBlockHeight: planned!.lastValidBlockHeight,
  };
}
