import { createHash, randomUUID } from "node:crypto";
import { DESCRIPTION } from "../../lib/strategy";
import { ApiError } from "../../lib/api-security";
import { DEFAULT_LAUNCH_SETTINGS, DEFAULT_SELL_PLAN, canonicalLaunchSettings, storedLaunchSettings, type LaunchSettings } from "../domain/launch-settings";
import { marketMakerWalletName } from "./holder-reward-launch";
import { Store, safeNumber } from "./store";
import { canonicalStrategy } from "../domain/strategies";
import type { StrategyConfigValue, Token } from "../db/schema";
import {
  hash,
  launchInput,
  safeInteger,
  solToLamports,
  type LaunchInput,
} from "../shared/domain";
export interface LaunchProvider {
  /** Balance hints only; deposit history remains authoritative for funding. */
  fundedWallets?(wallets: string[]): Promise<Set<string>>;
  /** Generates and stores the token's mint keypair; the CA stays private until deployed. */
  createMint(): { mintSignerRef: string; mint: string };
  prepare(input: {
    tokenId: number;
    name: string;
    symbol: string;
    description: string;
    image: string;
    website: string;
    x?:string;
    telegram?:string;
    devBuyLamports: number;
    refreshMetadata?: boolean;
    /** Existing launches keep their stored wallet names. */
    fundingWalletName?: string | null;
    mintSignerRef?: string | null;
  }): Promise<{
    fundingWallet: string;
    fundingWalletName: string;
    mintSignerRef: string | null;
    rewardWallet: string;
    metadataUri: string;
    requiredLamports: number;
  }>;
  /** Best-effort early observation. A pending signature may precede finalized deposits. */
  hasIncomingFunds?(fundingWallet: string): Promise<boolean>;
  deposits(
    tokenId: number,
    fundingWallet: string,
  ): Promise<
    {
      signature: string;
      lamports: number;
      confirmedAt: number;
      confirmedSlot: number;
    }[]
  >;
  prepareDeployment(input: {
    tokenId: number;
    fundingWallet: string;
    metadataUri: string;
    name: string;
    symbol: string;
    devBuyLamports: number;
    mintSignerRef: string | null;
    /** Pump holder-reward coin with the launch buy from a public market-making wallet. */
    holderRewards?: boolean;
  }): Promise<{ intent: string; mintSignerRef: string; marketMaker?: string }>;
  executeDeployment(intent: string): Promise<{
    status: "pending" | "confirmed" | "expired";
    signature: string;
    mint: string;
  }>;
  /** Must prove the old transaction cannot execute before signing a replacement. */
  refreshDeployment?(intent: string): Promise<string>;
}

/** Private launch-status handle: unguessable while the CA is secret, and
 * public-safe once the token is live (everything is public by then). */
export function launchHandle(mint: string): string {
  return createHash("sha256").update(`launchseeds-launch:${mint}`).digest("hex").slice(0, 32);
}

/** Wallets of a prepared launch; only `preparing` launches lack them. */
function preparedWallets(token: Token) {
  if (!token.fundingWallet || !token.rewardWallet)
    throw new Error("Launch is not prepared");
  return { fundingWallet: token.fundingWallet, rewardWallet: token.rewardWallet };
}

export class LaunchService {
  static readonly PREPARATION_LEASE_MS = 120_000;
  constructor(
    readonly store: Store,
    readonly provider?: LaunchProvider,
  ) {}
  async create(
    raw: LaunchInput,
    capability: string,
    onCreated?: (tokenId: number) => void,
    settings: LaunchSettings = DEFAULT_LAUNCH_SETTINGS,
  ) {
    if (!this.provider) throw new Error("Launch service is not configured");
    const input = launchInput.parse({ ...raw, description: DESCRIPTION });
    if (!/^[a-f0-9]{64}$/.test(capability))
      throw new Error("Invalid launch key");
    // A holder-reward coin always has a public sell plan; the default ladder if none was chosen.
    if (settings.holderRewards && !settings.sellPlan.length) settings = { ...settings, sellPlan: [...DEFAULT_SELL_PLAN] };
    const launchSettingsJson = canonicalLaunchSettings(settings);
    // The market maker's launch buy is the dev buy: a holder-reward coin needs one.
    if (settings.holderRewards && !(solToLamports(input.devBuySol) > 0))
      throw new Error("Holder-reward launches need a launch buy for the market maker");
    const accessHash = hash(capability),
      requestHash = hash(JSON.stringify({ input, settingsJson: launchSettingsJson }));
    const existingId = this.existing(accessHash, requestHash);
    let tokenId = existingId;
    if (tokenId === null) {
      // A lost race leaves only an unused, unfunded mint key behind.
      const mint = this.provider.createMint();
      tokenId = this.store.repo.tx((tx) => {
        const raced = tx.tokens.getByAccess(accessHash);
        if (raced) {
          if (raced.requestHash !== requestHash)
            throw new Error("Launch key already used for another request");
          return raced.id;
        }
        return tx.tokens.insert({
          handle: launchHandle(mint.mint),
          mint: null,
          mintSignerRef: mint.mintSignerRef,
          name: input.name,
          symbol: input.symbol,
          description: input.description,
          image: input.image,
          metadataUri: null,
          website: input.website,
          x: input.x,
          telegram: input.telegram,
          fundingWallet: null,
          fundingWalletName: null,
          creatorWallet: null,
          rewardWallet: null,
          launcherWallet: null,
          devBuyRecipient: null,
          refundWallet: null,
          launchSettingsJson,
          status: "preparing",
          deploySignature: null,
          feeConfigSignature: null,
          error: null,
          activeStrategyId: null,
          leaderStrategyId: null,
          leaderSince: null,
          lastGravityMinute: null,
          createdAt: Date.now(),
          launchedAt: null,
          accessHash,
          requestHash,
          inputJson: JSON.stringify(input),
        });
      });
    }
    // Persist strategy before publishing a funding destination.
    onCreated?.(tokenId);
    await this.resumePreparation(tokenId);
    return this.statusById(tokenId);
  }
  private existing(accessHash: string, requestHash: string): number | null {
    const existing = this.store.repo.tokens.getByAccess(accessHash);
    if (!existing) return null;
    if (existing.requestHash !== requestHash)
      throw new Error("Launch key already used for another request");
    return existing.id;
  }
  async resumePreparation(tokenId: number, now = Date.now()) {
    if (!this.provider) return false;
    const leaseId = crypto.randomUUID();
    const claimed = this.store.repo.tx((tx) => {
      const t = tx.tokens.get(tokenId);
      if (!t || t.status !== "preparing" || t.leaseUntil > now) return false;
      tx.tokens.updateLaunch(tokenId, {
        leaseId,
        leaseUntil: now + LaunchService.PREPARATION_LEASE_MS,
        attempts: t.attempts + 1,
        error: null,
      });
      return t;
    });
    if (!claimed) return false;
    const input = launchInput.parse(JSON.parse(claimed.inputJson));
    try {
      const devBuyLamports = solToLamports(input.devBuySol);
      const prepared = await this.provider.prepare({
        tokenId,
        ...input,
        devBuyLamports,
        fundingWalletName: claimed.fundingWalletName,
        mintSignerRef: claimed.mintSignerRef,
      });
      safeInteger(prepared.requiredLamports);
      if (prepared.requiredLamports <= devBuyLamports || !prepared.metadataUri)
        throw new Error("Invalid launch preparation");
      return this.store.repo.tx((tx) => {
        const t = tx.tokens.get(tokenId);
        if (!t || t.leaseId !== leaseId || t.status !== "preparing") return false;
        const state = tx.operations.state(tokenId);
        if (!state) throw new Error("Initial strategy missing");
        return tx.tokens.markPrepared(tokenId, {
          fundingWallet: prepared.fundingWallet,
          fundingWalletName: prepared.fundingWalletName,
          creatorWallet: prepared.rewardWallet,
          rewardWallet: prepared.rewardWallet,
          mintSignerRef: prepared.mintSignerRef,
          metadataUri: prepared.metadataUri,
          requiredLamports: String(prepared.requiredLamports),
          devBuyLamports: String(devBuyLamports),
          quoteExpiresAt: now + 30 * 60_000,
          activeStrategyId: state.initialStrategyId,
          leaseId: "",
          leaseUntil: 0,
          error: null,
        });
      });
    } catch (error) {
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (current?.leaseId === leaseId)
          tx.tokens.updateLaunch(tokenId, {
            leaseId: "",
            leaseUntil: 0,
            error:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Preparation failed",
          });
      });
      throw error;
    }
  }
  /**
   * Amend an unconfirmed, nonfunded launch without changing the recipient
   * address. A lease excludes the worker while metadata is re-pinned.
   * Both finalized on-chain deposits and recorded deposits are checked;
   * an address is never rotated or silently orphaned.
   */
  async amend(
    handle: string,
    raw: LaunchInput,
    capability: string,
    settings: LaunchSettings,
    firstStrategy: StrategyConfigValue,
  ) {
    if (!this.provider || !/^[a-f0-9]{64}$/.test(capability))
      throw new ApiError("Invalid launch amendment", 401);
    const input = launchInput.parse({ ...raw, description: DESCRIPTION });
    const launchSettingsJson = canonicalLaunchSettings(settings);
    const leaseId = crypto.randomUUID();
    const now = Date.now();
    const token = this.store.repo.tx((tx) => {
      const token = tx.tokens.getByHandle(handle);
      if (!token || token.accessHash !== hash(capability))
        throw new Error("Not found");
      if (tx.freeLaunches.byToken(token.id))
        throw new ApiError("A sponsorship payment is already prepared. Token details are locked.", 409);
      if (token.status !== "funding" ||
          token.fundingReceivedLamports !== "0" ||
          tx.deposits.sumLamports(token.id) !== 0n)
        throw new ApiError("This launch is already funded or being deployed", 409);
      if (token.leaseUntil > now)
        throw new ApiError("Another launch operation is in progress", 409);
      tx.tokens.updateLaunch(token.id, {
        leaseId, leaseUntil: now + LaunchService.PREPARATION_LEASE_MS,
      });
      return token;
    });
    const tokenId = token.id;
    const wallets = preparedWallets(token);
    try {
      const verifyUnfunded = async () => {
        if (this.provider!.hasIncomingFunds &&
            await this.provider!.hasIncomingFunds(wallets.fundingWallet)) {
          throw new ApiError("A payment is already arriving. Token details are locked.", 409);
        }
        const deposits = await this.provider!.deposits(tokenId, wallets.fundingWallet);
        if (deposits.some((deposit) => deposit.lamports > 0))
          throw new ApiError("A payment has been detected. Token details are now locked.", 409);
      };
      await verifyUnfunded();
      const devBuyLamports = solToLamports(input.devBuySol);
      const prepared = await this.provider.prepare({
        tokenId, ...input, devBuyLamports, refreshMetadata: true,
        fundingWalletName: token.fundingWalletName,
        mintSignerRef: token.mintSignerRef,
      });
      if (prepared.fundingWallet !== wallets.fundingWallet ||
          prepared.rewardWallet !== wallets.rewardWallet ||
          prepared.requiredLamports <= devBuyLamports ||
          !prepared.metadataUri)
        throw new ApiError("Revised launch quote changed wallet identity or lacks metadata", 503);
      await verifyUnfunded();
      const { config, configKey, configJson } = canonicalStrategy(firstStrategy);
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (!current || current.leaseId !== leaseId ||
            current.status !== "funding" ||
            current.fundingReceivedLamports !== "0" ||
            tx.deposits.sumLamports(tokenId) !== 0n)
          throw new ApiError("Launch changed during amendment", 409);
        const state = tx.operations.state(tokenId);
        if (!state) throw new Error("Initial strategy missing");
        const initial = tx.strategies.getOrCreate({
          tokenId, type: config.type,
          configKey, configJson, enabled: true, createdAt: Date.now(),
        });
        tx.operations.updateState(tokenId, {
          initialStrategyId: initial.id, switchedAt: Date.now(),
        });
        tx.tokens.setGovernance(tokenId, {
          activeStrategyId: initial.id, leaderStrategyId: null, leaderSince: null,
        });
        tx.tokens.updateUnfundedDetails(tokenId, {
          name: input.name, symbol: input.symbol, description: input.description,
          image: input.image, website: input.website,
          x: input.x || "", telegram: input.telegram || "",
          metadataUri: prepared.metadataUri,
          requiredLamports: String(prepared.requiredLamports),
          devBuyLamports: String(devBuyLamports),
          launchSettingsJson,
          // A revised quote gets a fresh 30-minute window, like a new one.
          quoteExpiresAt: Date.now() + 30 * 60_000,
        });
        tx.tokens.updateLaunch(tokenId, {
          inputJson: JSON.stringify(input),
          requestHash: hash(JSON.stringify({ input, settingsJson: launchSettingsJson })),
          leaseId: "", leaseUntil: 0, error: null,
        });
      });
      return this.statusById(tokenId);
    } finally {
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (current?.leaseId === leaseId)
          tx.tokens.updateLaunch(tokenId, { leaseId: "", leaseUntil: 0 });
      });
    }
  }

  status(handle: string, capability: string) {
    const token = this.store.repo.tokens.getByHandle(handle);
    if (!token || token.accessHash !== hash(capability)) throw new Error("Not found");
    return this.statusById(token.id);
  }
  /** Read-only launch progress addressed by the private handle. */
  publicStatus(handle: string) {
    const token = this.store.repo.tokens.getByHandle(handle);
    if (!token) throw new Error("Not found");
    return this.statusById(token.id);
  }
  private statusById(tokenId: number) {
    const token = this.store.repo.tokens.get(tokenId);
    if (!token) throw new Error("Not found");
    const live = token.status === "live";
    return {
      handle: token.handle,
      status: token.status,
      name: token.name,
      symbol: token.symbol,
      fundingWallet: token.fundingWallet || "",
      requiredLamports: safeNumber(token.requiredLamports),
      receivedLamports: safeNumber(token.fundingReceivedLamports),
      // The CA is only published once the token is live.
      mint: live ? token.mint || "" : "",
      launchSignature: token.deploySignature || "",
      settings: storedLaunchSettings(token.launchSettingsJson),
      // Funding address and amount are valid until this time (countdown on the pay step).
      expiresAt: token.quoteExpiresAt,
      devBuyLamports: safeNumber(token.devBuyLamports),
      rewardFundVerified: Boolean(live && token.rewardWallet &&
        BigInt(token.devBuyLamports) > 0n &&
        BigInt(this.store.repo.holders.get(tokenId, token.rewardWallet)?.balanceRaw ?? "0") > 0n),
      error: token.error
        ? "Launch needs operator attention. Do not send more funds."
        : "",
    };
  }
  async process(tokenId: number) {
    if (!this.provider) throw new Error("Launch service is not configured");
    const leaseId = randomUUID();
    const acquired = this.store.repo.tx(tx => {
      const current = tx.tokens.get(tokenId);
      if (!current || !["funding", "deploying"].includes(current.status) || current.leaseUntil > Date.now()) return false;
      tx.tokens.updateLaunch(tokenId, { leaseId, leaseUntil: Date.now() + LaunchService.PREPARATION_LEASE_MS });
      return true;
    });
    if (!acquired) return;
    const assertLease = () => {
      const current = this.store.repo.tokens.get(tokenId);
      if (current?.leaseId !== leaseId || current.leaseUntil <= Date.now()) throw new Error("Launch processing lease lost; reconcile persisted intent");
    };
    const heartbeat = setInterval(() => {
      const current = this.store.repo.tokens.get(tokenId);
      if (current?.leaseId === leaseId && current.leaseUntil > Date.now())
        this.store.repo.tokens.updateLaunch(tokenId, { leaseUntil: Date.now() + LaunchService.PREPARATION_LEASE_MS });
    }, 10_000);
    heartbeat.unref();
    try { await this.processLeased(tokenId, assertLease); }
    finally {
      clearInterval(heartbeat);
      this.store.repo.tx(tx => {
        if (tx.tokens.get(tokenId)?.leaseId === leaseId)
          tx.tokens.updateLaunch(tokenId, { leaseId: "", leaseUntil: 0 });
      });
    }
  }
  private async processLeased(tokenId: number, assertLease: () => void) {
    const provider = this.provider!;
    assertLease();
    let token = this.store.repo.tokens.get(tokenId);
    if (!token) throw new Error("Not found");
    if (!["funding", "deploying"].includes(token.status)) return;
    if (token.status === "funding") {
      const { fundingWallet } = preparedWallets(token);
      const deposits = await provider.deposits(tokenId, fundingWallet);
      assertLease();
      this.store.repo.tx((tx) => {
        for (const d of deposits) {
          safeInteger(d.lamports);
          tx.deposits.record({
            tokenId,
            signature: d.signature,
            lamports: String(d.lamports),
            confirmedSlot: d.confirmedSlot,
            confirmedAt: d.confirmedAt,
            refundSignature: null,
          });
        }
        tx.tokens.update(tokenId, {
          fundingReceivedLamports: tx.deposits.sumLamports(tokenId).toString(),
        });
      });
      token = this.store.repo.tokens.get(tokenId)!;
      if (
        BigInt(token.fundingReceivedLamports) < BigInt(token.requiredLamports)
      )
        return;
      const prepared = await provider.prepareDeployment({
        tokenId,
        fundingWallet,
        metadataUri: token.metadataUri!,
        name: token.name,
        symbol: token.symbol,
        devBuyLamports: safeNumber(token.devBuyLamports),
        mintSignerRef: token.mintSignerRef,
        holderRewards: storedLaunchSettings(token.launchSettingsJson).holderRewards,
      });
      assertLease();
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId)!;
        if (current.status !== "funding") return;
        tx.tokens.updateLaunch(tokenId, { intent: prepared.intent });
        tx.tokens.update(tokenId, { mintSignerRef: prepared.mintSignerRef });
        // The public market-making wallet receives the launch buy.
        if (prepared.marketMaker) tx.tokens.assignMarketMaker(tokenId, prepared.marketMaker);
        tx.tokens.transition(tokenId, "funding", "deploying");
      });
    }
    const intent = this.store.repo.tokens.get(tokenId)?.intent;
    if (!intent) throw new Error("Missing persisted launch intent");
    assertLease();
    let result = await provider.executeDeployment(intent);
    assertLease();
    if (result.status === "expired") {
      if (!provider.refreshDeployment)
        throw new Error("Launch intent expired; reconciliation required");
      const replacement = await provider.refreshDeployment(intent);
      assertLease();
      const stored = this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (current?.status !== "deploying" || current.intent !== intent) return false;
        tx.tokens.updateLaunch(tokenId, { intent: replacement, error: null });
        tx.tokens.update(tokenId, { deploySignature: null });
        return true;
      });
      if (!stored) return;
      result = await provider.executeDeployment(replacement);
      assertLease();
    }
    if (result.status === "pending")
      this.store.repo.tokens.update(tokenId, { deploySignature: result.signature });
    if (result.status === "confirmed")
      this.store.repo.tx((tx) => {
        if (!tx.tokens.transition(tokenId, "deploying", "live", {
          mint: result.mint,
          deploySignature: result.signature,
          launchedAt: Date.now(),
        }))
          return;
        // A holder-reward coin's treasury is its public market-making wallet: the
        // fixed sell plan's profit is spent from there on the coin's strategy.
        const live = tx.tokens.get(tokenId)!;
        if (storedLaunchSettings(live.launchSettingsJson).holderRewards && live.devBuyRecipient)
          tx.tokens.adoptMarketMakerTreasury(tokenId, { rewardWallet: live.devBuyRecipient, fundingWalletName: marketMakerWalletName(result.mint) });
      });
  }
}
