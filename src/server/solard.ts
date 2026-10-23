import { loadSolard, type SolardClient, type TraderClient } from "./solard-sdk";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createMeasure } from "measure-fn";
import { safeInteger, positive } from "../shared/domain";
import type { LaunchProvider } from "./launch";
import { Store } from "./store";
const { measure } = createMeasure("launchseeds:solard");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export class SolardSource {
  constructor(readonly sdk: SolardClient) {}
  static async create(rpcUrl: string) {
    const sdk = await loadSolard();
    return new SolardSource(
      sdk.createSolard({
        rpcUrl,
        dbPath: process.env.SOLARD_DB_PATH || "./data/solard.sqlite",
      }),
    );
  }
  async sample(mint: string, exclusions: string[] = []) {
    return measure("finalized holders and USD price", async () => {
      await this.sdk.addToken(mint);
      const [snapshot, price] = await Promise.all([
        this.sdk.snapshotHolders(mint, {
          commitment: "finalized",
          excludeOwners: exclusions,
        }),
        this.sdk.samplePrice(mint),
      ]);
      let priceUsd = price.priceQuotePerToken;
      if (price.quoteAsset.kind === "native-sol") {
        const response = await fetch(
          "https://api.coinbase.com/v2/prices/SOL-USD/spot",
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!response.ok) throw new Error("SOL/USD price is unavailable");
        const data = (await response.json()) as {
          data: { amount: string; currency: string; base: string };
        };
        if (data.data.currency !== "USD" || data.data.base !== "SOL")
          throw new Error("Unexpected price pair");
        priceUsd *= positive(Number(data.data.amount));
      } else if (price.quoteAsset.mint.toBase58() !== USDC)
        throw new Error("Unsupported quote currency");
      positive(priceUsd);
      if (Date.now() - price.capturedAtMs > 120_000)
        throw new Error("Stale token price");
      return {
        priceUsd,
        snapshot: {
          holders: [
            ...snapshot.holders.map((holder) => ({
              wallet: holder.owner,
              balance: Number(holder.amountUi),
              balanceUi: holder.amountUi,
              excluded: "",
            })),
            ...snapshot.excluded.map((holder) => ({
              wallet: holder.owner,
              balance: Number(holder.amountUi),
              balanceUi: holder.amountUi,
              excluded: holder.reason,
            })),
          ],
          slot: snapshot.slot,
          observedAt: snapshot.observedAtMs,
          complete: true,
        },
      };
    });
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
    readonly publicUrl: string,
    readonly baseLamports: number,
  ) {
    if (!publicUrl.startsWith("https://"))
      throw new Error("PUBLIC_BASE_URL must be HTTPS for token metadata");
    safeInteger(baseLamports);
    positive(baseLamports);
    this.connection = new Connection(rpcUrl, "finalized");
  }
  static async create(
    store: Store,
    rpcUrl: string,
    publicUrl: string,
    baseLamports: number,
  ) {
    const sdk = await loadSolard();
    return new SolardLaunchProvider(
      sdk.createTraderSolard({
        rpcUrl,
        dbPath: process.env.SOLARD_DB_PATH || "./data/solard.sqlite",
      }),
      store,
      rpcUrl,
      publicUrl,
      baseLamports,
    );
  }
  async prepare(input: { uid: string; devBuyLamports: number }) {
    const walletName = `launchseeds-${input.uid}`;
    // The UID-based wallet name is the provider's idempotency key.
    // After a racing create failure, re-read the persisted wallet rather than
    // generating a different address for the same launch.
    let wallet = this.sdk
      .listWallets()
      .find((item) => item.name === walletName);
    if (!wallet) {
      try {
        const created = this.sdk.createWallet(walletName);
        wallet = { ...created, name: walletName };
      } catch (error) {
        wallet = this.sdk
          .listWallets()
          .find((item) => item.name === walletName);
        if (!wallet) throw error;
      }
    }
    return {
      fundingWallet: wallet.address,
      rewardWallet: wallet.address,
      metadataUri: `${this.publicUrl.replace(/\/$/, "")}/api/metadata/${input.uid}`,
      requiredLamports: safeInteger(this.baseLamports + input.devBuyLamports),
    };
  }
  async deposits(_uid: string, fundingWallet: string) {
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
    uid: string;
    fundingWallet: string;
    metadataUri: string;
    name: string;
    symbol: string;
    devBuyLamports: number;
  }) {
    const mintWalletName = `launchseeds-mint-${input.uid}`;
    const mintWallet =
      this.sdk.listWallets().find((wallet) => wallet.name === mintWalletName) ||
      this.sdk.createWallet(mintWalletName);
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
    };
  }
  async executeDeployment(intent: string) {
    const plan = JSON.parse(intent) as {
      transaction: string;
      signature: string;
      mint: string;
      lastValidBlockHeight: number;
    };
    const transaction = VersionedTransaction.deserialize(
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
    if (
      (await this.connection.getBlockHeight("finalized")) >
      plan.lastValidBlockHeight
    )
      throw new Error("Launch intent expired; reconcile before replacement");
    await this.connection.sendRawTransaction(
      Buffer.from(plan.transaction, "base64"),
      { skipPreflight: false, maxRetries: 0 },
    );
    return {
      status: "pending" as const,
      signature: plan.signature,
      mint: plan.mint,
    };
  }
  close() {
    this.sdk.close();
  }
}
