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
  /** Read-only: no signer or submission is involved. */
  getClaimableCreatorFees(
    wallet: string,
    options: { tokens: string[] },
  ): Promise<{
    groups: { quoteMint: string; quoteDecimals: number; amountRaw: bigint }[];
  }>;
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
  /** `privateKey` is a JSON byte array or base58 secret key. */
  importWallet(privateKey: string, name?: string): { address: string };
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
    createSolard(options: { rpcUrl: string; rpcUrls?: string[]; dbPath: string }): SolardClient;
    createTraderSolard(options: {
      rpcUrl: string;
      rpcUrls?: string[];
      dbPath: string;
    }): TraderClient;
  };
}

export interface PumpMetadataInput {
 imagePath:string;name:string;symbol:string;description?:string;website?:string;twitter?:string;telegram?:string;
}
export type MetadataUploader = (input:PumpMetadataInput,options?:{provider?:"pump-frontend"|"pinata";fallback?:null})=>Promise<{metadataUri:string}>;
export async function loadMetadataUploader():Promise<MetadataUploader> {
 const name:string="@solard/core";
 return ((await import(name)) as {uploadPumpMetadata:MetadataUploader}).uploadPumpMetadata;
}
export type WireTransaction = { signatures: Uint8Array[]; serialize(): Uint8Array; sign(signers: Keypair[], lastValidBlockHeight?: number): Promise<void> };
/** Solard's wire-version-aware builder: v1 transactions hold up to 4096 bytes. */
export async function loadWireTransaction() {
  const name: string = "@solard/core/tx/wire-transaction.ts";
  return (await import(name)) as {
    buildV1Transaction(payer: PublicKey, draft: { instructions: TransactionInstruction[]; signers: Keypair[]; actions: never[]; trackedAccounts: never[]; cuLimit?: number }, blockhash: string, lastValidBlockHeight: number): Promise<WireTransaction>;
    deserializeWireTransaction(bytes: Uint8Array): { signatures: Uint8Array[] };
  };
}
