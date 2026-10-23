import type {
  PublicKey,
  Keypair,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
// Narrow integration contract verified against @solard/sdk 0.2.37 source.
// Runtime import is isolated because that release exports its entire core TS source,
// including unrelated broken declarations; see docs/handoffs/solard-sdk.md.
export interface SolardClient {
  addToken(mint: string): Promise<unknown>;
  snapshotHolders(
    mint: string,
    options: { commitment: "finalized"; excludeOwners: string[] },
  ): Promise<{
    holders: { owner: string; amountUi: string }[];
    excluded: { owner: string; amountUi: string; reason: string }[];
    slot: number;
    observedAtMs: number;
  }>;
  samplePrice(mint: string): Promise<{
    priceQuotePerToken: number;
    quoteAsset: { kind: "native-sol" | "spl-token"; mint: PublicKey };
    capturedAtMs: number;
  }>;
  listenTrades(options: {
    tokens: string[];
    history: false;
  }): Promise<TradeListener>;
  close(): void;
}
export interface TradeListener {
  add(mints: string[]): Promise<void>;
  remove(mints: string[]): Promise<void>;
  list(): string[];
  onTrade(callback: (event: { mint: string }) => void): () => void;
  close(): Promise<void>;
}
export interface TraderClient {
  addToken(
    mint: string,
    name?: string,
    metadata?: { venueHint: string },
  ): Promise<unknown>;
  claims: {
    creatorFees: {
      claim(
        mint: string,
        wallet: string,
        options: { id: string },
      ): Promise<{
        receipt: { status: string };
        claimSignature: string;
        quoteAsset: { kind: string; mint: string };
        payouts: { address: string; amountRaw: bigint }[];
        tokenMint: string;
      }>;
    };
  };
  buy(
    token: string,
    wallet: string,
    amount: { sol: string },
    options: { intentKey: string; slippageBps: number },
  ): Promise<{
    status: string;
    signature?: string;
    targetTokenDeltaRaw: bigint | null;
  }>;

  listWallets(): { name: string | null; address: string }[];
  createWallet(name: string): { address: string };
  signer(wallet: string): Keypair;
  prepareTokenDeployment(
    launchpad: string,
    wallet: string,
    args: {
      name: string;
      symbol: string;
      uri: string;
      mint: Keypair;
      creatorBuySol?: { sol: string };
    },
  ): Promise<{
    instructions: TransactionInstruction[];
    signers: Keypair[];
    mint: Keypair;
  }>;
  transaction(wallet: string): {
    addMany(instructions: TransactionInstruction[]): {
      withSigner(signer: Keypair): unknown;
      build(): Promise<{
        transaction: VersionedTransaction;
        lastValidBlockHeight: number;
      }>;
    };
  };
  simulatePlan(plan: unknown): Promise<{ success: boolean }>;
  close(): void;
}
export async function loadSolard() {
  const packageName: string = "@solard/sdk";
  return (await import(packageName)) as {
    createSolard(options: { rpcUrl: string; dbPath: string }): SolardClient;
    createTraderSolard(options: {
      rpcUrl: string;
      dbPath: string;
    }): TraderClient;
  };
}
