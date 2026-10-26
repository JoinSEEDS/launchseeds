import { ApiError } from "../../lib/api-security";
import { uploadedImagePath } from "../integrations/metadata";
import { loadMetadataUploader, type MetadataUploader } from "./solard-sdk";
import { loadSolard, loadWireTransaction, type SolardClient, type TraderClient } from "./solard-sdk";
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createMeasure } from "measure-fn";
import { safeInteger, positive } from "../shared/domain";
import type { LaunchProvider } from "./launch";
import { Store } from "./store";
import { createRpcConnection, rpcFetch } from "./rpc-pacing";
import { lastKnownSolUsd, rememberSolUsd } from "./sol-price";
import { holderRewardLaunchInstructions, marketMakerWalletName } from "./holder-reward-launch";
const { measure } = createMeasure("launchseeds:solard");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
// Several independent SOL/USD sources: any single one can be unreachable
// (e.g. ISP DNS filtering blocks api.coinbase.com on some networks).
const SOL_USD_SOURCES: Array<[string, (data: any) => unknown]> = [
  ["https://api.coinbase.com/v2/prices/SOL-USD/spot", (d) =>
    d?.data?.base === "SOL" && d?.data?.currency === "USD" ? d.data.amount : null],
  [`https://lite-api.jup.ag/price/v3?ids=${WSOL}`, (d) => d?.[WSOL]?.usdPrice],
  ["https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", (d) => d?.solana?.usd],
];
export async function solUsd(): Promise<number> {
  const fresh = lastKnownSolUsd(60_000);
  if (fresh) return fresh;
  const value = await fetchSolUsd();
  rememberSolUsd(value);
  return value;
}
async function fetchSolUsd(): Promise<number> {
  const failures: string[] = [];
  for (const [url, pick] of SOL_USD_SOURCES) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = Number(pick(await response.json()));
      if (Number.isFinite(value) && value > 0) return value;
      throw new Error("Unexpected price payload");
    } catch (error) {
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new Error(`SOL/USD price is unavailable (${failures.join("; ")})`);
}
export class SolardSource {
  constructor(readonly sdk: SolardClient) {}
  static async create(rpcUrl: string) {
    const sdk = await loadSolard();
    return new SolardSource(
      sdk.createSolard({
        rpcUrl,
        rpcUrls: [rpcUrl],
        dbPath: process.env.SOLARD_DB_PATH || "./data/solard.sqlite",
      }),
    );
  }
  static async createTrader(rpcUrl: string) {
    const sdk = (await loadSolard()).createTraderSolard({ rpcUrl, rpcUrls: [rpcUrl], dbPath: process.env.SOLARD_DB_PATH || "./data/solard.sqlite" });
    if (typeof sdk.signer !== "function" || !sdk.claims?.creatorFees || typeof sdk.buy !== "function") throw new Error("Solard trading capabilities unavailable");
    return new SolardSource(sdk as unknown as SolardClient);
  }
  async priceUsd(mint: string): Promise<string> {
    await this.sdk.addToken(mint);
    const price = await this.sdk.samplePrice(mint);
    let priceUsd = price.priceQuotePerToken;
    if (price.quoteAsset.kind === "native-sol") {
      priceUsd *= positive(await solUsd());
    } else if (price.quoteAsset.mint.toBase58() !== USDC)
      throw new Error("Unsupported quote currency");
    positive(priceUsd);
    if (
      !Number.isSafeInteger(price.capturedAtMs) ||
      price.capturedAtMs > Date.now() + 5000 ||
      Date.now() - price.capturedAtMs > 120_000
    )
      throw new Error("Stale token price");
    return priceUsd.toFixed(12).replace(/\.?0+$/, "") || "0";
  }
  /** Unclaimed creator fees sitting in the token's venue vault, in USD micros.
   * Pump creator vaults are per creator wallet; every LaunchSeeds token has its own. */
  async unclaimedCreatorFeesMicros(wallet: string, mint: string): Promise<number> {
    const { groups } = await this.sdk.getClaimableCreatorFees(wallet, { tokens: [mint] });
    let usd = 0;
    for (const group of groups) {
      const amount = Number(group.amountRaw) / 10 ** group.quoteDecimals;
      if (group.quoteMint === WSOL) usd += amount * positive(await solUsd());
      else if (group.quoteMint === USDC) usd += amount;
    }
    return Math.round(usd * 1e6);
  }
  /** SOL-quoted creator fees waiting for `wallet` (a Solard wallet name), in lamports. */
  async claimableLamports(wallet: string, mint: string): Promise<bigint> {
    const { groups } = await this.sdk.getClaimableCreatorFees(wallet, { tokens: [mint] });
    return groups.filter((g) => g.quoteMint === WSOL).reduce((sum, g) => sum + BigInt(g.amountRaw), 0n);
  }
  /** Durable creator-fee claim signed by the named Solard wallet. The same `id`
   * resumes the same claim; payouts are measured from the confirmed transaction. */
  async claimCreatorFees(wallet: string, mint: string, id: string) {
    const trader = this.sdk as unknown as TraderClient;
    const connection = createRpcConnection(process.env.SOLANA_RPC_URL!, "finalized");
    if (await connection.getBalance(trader.signer(wallet).publicKey, "confirmed") < 10_000)
      throw new Error("Treasury needs SOL for the initial claim network fee");
    const result = await trader.claims.creatorFees.claim(mint, wallet, { id });
    if (result.receipt.status !== "confirmed")
      throw new Error(`Claim ${result.claimSignature} is ${result.receipt.status}; will resume`);
    const status = (await connection.getSignatureStatuses([result.claimSignature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`Claim ${result.claimSignature} failed on-chain`);
    if (status?.confirmationStatus !== "finalized") throw new Error(`Claim ${result.claimSignature} awaiting finality; will resume`);
    const quote = result.quoteAsset as { kind: string; mint?: unknown };
    return {
      signature: result.claimSignature,
      quoteIsSol: quote.kind === "native-sol" || String(quote.mint ?? "") === WSOL,
      payouts: result.payouts.map((p) => ({ address: p.address, amountRaw: BigInt(p.amountRaw) })),
      blockTimeMs: null,
    };
  }
  /** Address of a named Solard wallet, created on first use. */
  walletAddress(name: string): string {
    const trader = this.sdk as unknown as TraderClient;
    const existing = trader.listWallets().find((w) => w.name === name);
    return existing ? existing.address : trader.createWallet(name).address;
  }
  async listen(mints: string[], refresh: (mint: string) => Promise<void>) {
    const listener = await this.sdk.listenTrades({
      tokens: mints,
      history: false,
    });
    const queues = new Map<string, Promise<void>>();
    listener.onTrade((event) => {
      if (queues.has(event.mint)) return;
      const task = refresh(event.mint)
        .catch((error) =>
          console.error(
            "Trade holder refresh failed",
            event.mint,
            error instanceof Error ? error.message : "Unknown error",
          ),
        )
        .finally(() => queues.delete(event.mint));
      queues.set(event.mint, task);
    });
    return listener;
  }
  close() {
    this.sdk.close();
  }
}
export class SolardLaunchProvider implements LaunchProvider {
  readonly connection;
  constructor(
    readonly sdk: TraderClient,
    readonly store: Store,
    readonly rpcUrl: string,
    readonly baseLamports: number,
    readonly uploadMetadata?: MetadataUploader,
  ) {
    safeInteger(baseLamports);
    positive(baseLamports);
    this.connection = createRpcConnection(rpcUrl, "finalized");
  }
  static async create(
    store: Store,
    rpcUrl: string,
    baseLamports: number,
  ) {
    const sdk = await loadSolard();
    return new SolardLaunchProvider(
      sdk.createTraderSolard({
        rpcUrl,
        rpcUrls: [rpcUrl],
        dbPath: process.env.SOLARD_DB_PATH || "./data/solard.sqlite",
      }),
      store,
      rpcUrl,
      baseLamports,
    );
  }
  async prepare(input: { tokenId:number;devBuyLamports:number;name:string;symbol:string;description:string;image:string;website:string;x?:string;telegram?:string;refreshMetadata?:boolean;fundingWalletName?:string|null;mintSignerRef?:string|null }) {
    const token=this.store.repo.tokens.get(input.tokenId);
    if(!token)throw new Error("Launch request not found");
    let metadataUri=input.refreshMetadata ? "" : token.metadataUri ?? "";
    if(!metadataUri){
      const upload=this.uploadMetadata??await loadMetadataUploader();
      const imagePath=await uploadedImagePath(input.image);
      const provider=process.env.PINATA_JWT?.trim()?"pinata":"pump-frontend";
      let uploaded;
      try {
        uploaded=await upload({imagePath,name:input.name,symbol:input.symbol,
          description:input.description,website:input.website,twitter:input.x,telegram:input.telegram},{provider,fallback:null});
      } catch(error) {
        console.error("Launch metadata upload failed:",error instanceof Error?error.message:"Unknown error");
        throw new ApiError(provider==="pump-frontend"
          ? "Token metadata upload failed. Pump rejected the upload; the server needs PINATA_JWT configured for IPFS uploads. No payment is required."
          : "Token metadata upload failed. Check the server's Pinata credentials and upload quota. No payment is required.",503);
      }
      if(!/^(ipfs:\/\/|https:\/\/[^/]+\/ipfs\/)/.test(uploaded.metadataUri))throw new Error("Metadata uploader did not return an IPFS URI");
      metadataUri=uploaded.metadataUri;
      if (!input.refreshMetadata) this.store.repo.tokens.updateLaunch(input.tokenId,{metadataUri});
    }
    // New launches carry the mint keypair made at creation, so both wallets are
    // named by the CA. The CA stays private (tokens.mint is set only once
    // deployed). An existing launch keeps the wallet names already stored on it.
    const mintSignerRef = input.mintSignerRef ?? token.mintSignerRef ?? null;
    let walletName = input.fundingWalletName ?? undefined;
    if (!walletName) {
      if (!mintSignerRef) throw new Error("Launch mint keypair is missing");
      walletName = `launchseeds-${this.walletAddress(mintSignerRef)}`;
    }
    const wallet = this.findOrCreateWallet(walletName);
    return {
      fundingWallet: wallet.address,
      fundingWalletName: walletName,
      mintSignerRef,
      rewardWallet: wallet.address,
      metadataUri,
      requiredLamports: safeInteger(this.baseLamports + input.devBuyLamports),
    };
  }
  /** Wallet names are the idempotency key. After a racing create failure,
   * re-read the persisted wallet rather than generating a different address. */
  private findOrCreateWallet(name: string) {
    const existing = this.sdk.listWallets().find((item) => item.name === name);
    if (existing) return existing;
    try {
      return { ...this.sdk.createWallet(name), name };
    } catch (error) {
      const raced = this.sdk.listWallets().find((item) => item.name === name);
      if (!raced) throw error;
      return raced;
    }
  }
  /** Generates the token's mint keypair and stores it as `launchseeds-mint-<CA>`.
   * A crash before the name is persisted leaves only an unused, unfunded key. */
  createMint() {
    const keypair = Keypair.generate();
    const mint = keypair.publicKey.toBase58();
    const mintSignerRef = `launchseeds-mint-${mint}`;
    this.sdk.importWallet(JSON.stringify([...keypair.secretKey]), mintSignerRef);
    return { mintSignerRef, mint };
  }
  private walletAddress(name: string): string {
    const wallet = this.sdk.listWallets().find((item) => item.name === name);
    if (!wallet) throw new Error("Launch mint wallet is missing from the wallet store");
    return wallet.address;
  }
  /** Address of a named treasury wallet (created on first use). */
  treasuryAddress(name: string): string {
    return this.findOrCreateWallet(name).address;
  }
  async balanceLamports(address: string): Promise<number> {
    return await this.connection.getBalance(new PublicKey(address), "confirmed");
  }
  /** Builds and simulates a signed SOL transfer from a named wallet; does not send. */
  async prepareSolTransfer(fromName: string, to: string, lamports: number) {
    const from = this.treasuryAddress(fromName);
    const plan = await this.sdk
      .transaction(from)
      .addMany([
        SystemProgram.transfer({
          fromPubkey: new PublicKey(from),
          toPubkey: new PublicKey(to),
          lamports: safeInteger(lamports),
        }),
      ])
      .build();
    if (!(await this.sdk.simulatePlan(plan)).success)
      throw new Error("Treasury transfer simulation failed");
    return {
      transaction: Buffer.from(plan.transaction.serialize()).toString("base64"),
      signature: bs58.encode(plan.transaction.signatures[0]!),
      lastValidBlockHeight: plan.lastValidBlockHeight,
    };
  }
  async sendPrepared(prepared: { transaction: string; signature: string; lastValidBlockHeight: number }) {
    const bytes = Buffer.from(prepared.transaction, "base64");
    const transaction = VersionedTransaction.deserialize(bytes);
    if (bs58.encode(transaction.signatures[0]!) !== prepared.signature)
      throw new Error("Stored sponsorship signature mismatch");
    const status = (await this.connection.getSignatureStatuses([prepared.signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error("Sponsorship transfer failed; operator reconciliation required");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    if ((await this.connection.getBlockHeight("finalized")) > prepared.lastValidBlockHeight)
      throw new Error("Sponsorship transfer expired; operator reconciliation required");
    await this.connection.sendRawTransaction(bytes, {
      skipPreflight: false,
      maxRetries: 3,
    });
  }
  /** Confirmed balance guards editing sooner than the finalized receipt journal. */
  async hasIncomingFunds(fundingWallet: string) {
    return (await this.connection.getBalance(
      new PublicKey(fundingWallet), "confirmed",
    )) > 0;
  }
  async fundedWallets(wallets: string[]): Promise<Set<string>> {
    return measure("Observe pending launch balances", async () => {
      const funded = new Set<string>();
      for (let offset = 0; offset < wallets.length; offset += 100) {
        const batch = wallets.slice(offset, offset + 100);
        const accounts = await this.connection.getMultipleAccountsInfo(batch.map(wallet => new PublicKey(wallet)), "confirmed");
        accounts.forEach((account, index) => { if (account && account.lamports > 0) funded.add(batch[index]!); });
      }
      return funded;
    });
  }
  async deposits(_tokenId: number, fundingWallet: string) {
    const signatures = await this.connection.getSignaturesForAddress(
      new PublicKey(fundingWallet),
      { limit: 100 },
      "finalized",
    );
    if (signatures.length === 100)
      throw new Error(
        "Funding history requires pagination; reconcile this launch",
      );
    const deposits = [];
    for (const item of signatures) {
      if (item.err) continue;
      const transaction = await this.connection.getParsedTransaction(
        item.signature,
        { commitment: "finalized", maxSupportedTransactionVersion: 0 },
      );
      if (!transaction?.meta || transaction.meta.err) continue;
      let lamports = 0;
      for (const instruction of transaction.transaction.message.instructions) {
        if (!("parsed" in instruction) || instruction.program !== "system")
          continue;
        const parsed = instruction.parsed;
        if (
          (parsed.type === "transfer" || parsed.type === "transferWithSeed") &&
          parsed.info.destination === fundingWallet
        )
          lamports += Number(parsed.info.lamports);
      }
      if (lamports > 0)
        deposits.push({
          signature: item.signature,
          lamports: safeInteger(lamports),
          confirmedAt: (item.blockTime || 0) * 1000,
          confirmedSlot: transaction.slot,
        });
    }
    return deposits;
  }
  async prepareDeployment(input: {
    tokenId: number;
    fundingWallet: string;
    metadataUri: string;
    name: string;
    symbol: string;
    devBuyLamports: number;
    mintSignerRef: string | null;
    holderRewards?: boolean;
  }) {
    // Launches created before CA naming have no mint keypair yet.
    const mintSignerRef = input.mintSignerRef || this.createMint().mintSignerRef;
    const mintWallet = { address: this.walletAddress(mintSignerRef) };
    if (input.holderRewards) return this.prepareHolderRewardDeployment(input, mintSignerRef, mintWallet.address);
    const deployment = await this.sdk.prepareTokenDeployment(
      "pump",
      input.fundingWallet,
      {
        name: input.name,
        symbol: input.symbol,
        uri: input.metadataUri,
        mint: this.sdk.signer(mintWallet.address),
        ...(input.devBuyLamports > 0
          ? { creatorBuySol: { sol: (input.devBuyLamports / 1e9).toFixed(9) } }
          : {}),
      },
    );
    const builder = this.sdk
      .transaction(input.fundingWallet)
      .addMany(deployment.instructions);
    for (const signer of deployment.signers) builder.withSigner(signer);
    const plan = await builder.build();
    const simulation = await this.sdk.simulatePlan(plan);
    if (!simulation.success)
      throw new Error("Token deployment simulation failed");
    return {
      intent: JSON.stringify({
        transaction: Buffer.from(plan.transaction.serialize()).toString(
          "base64",
        ),
        signature: bs58.encode(plan.transaction.signatures[0]!),
        mint: deployment.mint.publicKey.toBase58(),
        lastValidBlockHeight: plan.lastValidBlockHeight,
      }),
      mintSignerRef,
    };
  }
  /** Holder-reward coin, created and first bought by its public market-making wallet. */
  private async prepareHolderRewardDeployment(
    input: { fundingWallet: string; metadataUri: string; name: string; symbol: string; devBuyLamports: number },
    mintSignerRef: string,
    mint: string,
  ) {
    // `fundingWallet` is the funding wallet's address (a Solard wallet ref).
    const fundingAddress = input.fundingWallet;
    const marketMaker = this.findOrCreateWallet(marketMakerWalletName(mint)).address;
    const { instructions } = await holderRewardLaunchInstructions({
      connection: this.connection,
      mint: new PublicKey(mint),
      name: input.name,
      symbol: input.symbol,
      uri: input.metadataUri,
      fundingWallet: new PublicKey(fundingAddress),
      marketMaker: new PublicKey(marketMaker),
      buyLamports: input.devBuyLamports,
    });
    // A v1 transaction (up to 4096 bytes) fits the launch without a lookup table.
    const { buildV1Transaction } = await loadWireTransaction();
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = await buildV1Transaction(
      new PublicKey(fundingAddress),
      { instructions, signers: [], actions: [], trackedAccounts: [], cuLimit: 400_000 },
      blockhash,
      lastValidBlockHeight,
    );
    await transaction.sign([this.sdk.signer(fundingAddress), this.sdk.signer(marketMaker), this.sdk.signer(mint)], lastValidBlockHeight);
    const bytes = transaction.serialize();
    const simulation = await this.simulateWire(bytes);
    if (simulation) throw new Error(`Holder-reward launch simulation failed: ${simulation}`);
    return {
      intent: JSON.stringify({
        transaction: Buffer.from(bytes).toString("base64"),
        signature: bs58.encode(transaction.signatures[0]!),
        mint,
        lastValidBlockHeight,
      }),
      mintSignerRef,
      marketMaker,
    };
  }
  /** Signed simulation of raw transaction bytes (any wire version); the error, or null. */
  private async simulateWire(bytes: Uint8Array): Promise<string | null> {
    const response = await rpcFetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "simulateTransaction",
        params: [Buffer.from(bytes).toString("base64"), { encoding: "base64", sigVerify: true, commitment: "confirmed" }],
      }),
    });
    const body = (await response.json()) as { error?: { message?: string }; result?: { value?: { err: unknown; logs?: string[] } } };
    if (body.error) return body.error.message ?? "RPC error";
    const value = body.result?.value;
    if (!value) return "No simulation result";
    return value.err ? `${JSON.stringify(value.err)} ${(value.logs ?? []).slice(-3).join(" | ")}` : null;
  }
  async executeDeployment(intent: string) {
    const plan = JSON.parse(intent) as {
      transaction: string;
      signature: string;
      mint: string;
      lastValidBlockHeight: number;
    };
    const transaction = (await loadWireTransaction()).deserializeWireTransaction(
      Buffer.from(plan.transaction, "base64"),
    );
    if (bs58.encode(transaction.signatures[0]!) !== plan.signature)
      throw new Error("Persisted launch signature mismatch");
    const result = (
      await this.connection.getSignatureStatuses([plan.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (result?.err)
      throw new Error("Launch transaction failed; reconciliation required");
    if (
      result?.confirmationStatus === "finalized" ||
      result?.confirmationStatus === "confirmed"
    )
      return {
        status: "confirmed" as const,
        signature: plan.signature,
        mint: plan.mint,
      };
    if ((await this.connection.getBlockHeight("finalized")) > plan.lastValidBlockHeight) {
      if (result) throw new Error("Launch outcome is unresolved; reconciliation required");
      return { status: "expired" as const, signature: plan.signature, mint: plan.mint };
    }
    await this.connection.sendRawTransaction(
      Buffer.from(plan.transaction, "base64"),
      { skipPreflight: false, maxRetries: 3 },
    );
    return {
      status: "pending" as const,
      signature: plan.signature,
      mint: plan.mint,
    };
  }
  async refreshDeployment(intent: string): Promise<string> {
    const plan = JSON.parse(intent) as {
      transaction: string; signature: string; mint: string; lastValidBlockHeight: number;
      superseded?: unknown[];
    };
    const transaction = VersionedTransaction.deserialize(Buffer.from(plan.transaction, "base64"));
    if (bs58.encode(transaction.signatures[0]!) !== plan.signature)
      throw new Error("Persisted launch signature mismatch");
    if (!Number.isSafeInteger(plan.lastValidBlockHeight) ||
        (await this.connection.getBlockHeight("finalized")) <= plan.lastValidBlockHeight ||
        (await this.connection.isBlockhashValid(transaction.message.recentBlockhash, { commitment: "finalized" })).value)
      throw new Error("Launch transaction is not conclusively expired");
    const status = (await this.connection.getSignatureStatuses([plan.signature], { searchTransactionHistory: true })).value[0];
    if (status || await this.connection.getTransaction(plan.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }) ||
        await this.connection.getAccountInfo(new PublicKey(plan.mint), "confirmed"))
      throw new Error("Launch has an observed chain outcome; reconciliation required");
    const signers = transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .map((key) => this.sdk.signer(key.toBase58()));
    if (!signers.some((signer) => signer.publicKey.toBase58() === plan.mint))
      throw new Error("Launch mint does not match the persisted signers");
    const fresh = await this.connection.getLatestBlockhash("confirmed");
    transaction.message.recentBlockhash = fresh.blockhash;
    transaction.sign(signers);
    const { superseded = [], ...previous } = plan;
    return JSON.stringify({
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
      signature: bs58.encode(transaction.signatures[0]!),
      mint: plan.mint, lastValidBlockHeight: fresh.lastValidBlockHeight,
      superseded: [...superseded, previous],
    });
  }
  close() {
    this.sdk.close();
  }
}
