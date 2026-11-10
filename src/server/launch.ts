import { allocateTranches, allocateUserBatches, batchWalletCount, trancheFunding, userBatchFunding } from "../domain/user-funded-batches";
import { BUYER_RESERVE_LAMPORTS, JITO_TIP_LAMPORTS } from "./launch-bundle";
import { scheduledCommitment } from "../domain/scheduled-plan";
import { PublicKey, type Keypair } from "@solana/web3.js";
import { publicScheduledPlan } from "./scheduled-launches";
import { allocatedBudget, type BundleBuyer } from "./launch-bundle";
import { tokenVisible } from "./site-brand";
import { reservedMint } from "../domain/reserved-mint";
import { coinWebsite } from "../../lib/coin-url";
import { createHash, randomUUID } from "node:crypto";
import { DESCRIPTION } from "../../lib/strategy";
import { ApiError } from "../../lib/api-security";
import {
  DEFAULT_LAUNCH_SETTINGS,
  bundleFeeLamports,
  canonicalLaunchSettings,
  storedLaunchSettings,
  type LaunchSettings,
} from "../domain/launch-settings";
import { marketMakerWalletName } from "./holder-reward-launch";
import { deployerInUse, deployerKeypair, isOwnDeployer, needsDeployer, ownDeployerName } from "./own-deployer";
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
  readonly userBatches?: boolean;
  validateUserBatchLayout?(input:{token:Token;fundingWallet:string;metadataUri:string;buyers:BundleBuyer[];settings:LaunchSettings}):Promise<void>;
  /** Read-only worker-produced ceiling, checked before exposing payment details. */
  checkProtectionBudget?(
    lamports: number | null | undefined,
    exceptTokenId?: number,
  ): void;
  planBuyers?(mintSignerRef: string, budgets: bigint[]): BundleBuyer[];
  /** User-funded columns: per column, a pool signer then fresh wallets; then
   * each tranche's fresh wallets. Fresh wallets are reused when free. */
  planColumns?(token: { id: number; mintSignerRef: string; fundingWallet?: string | null }, columns: bigint[][], tranches?: bigint[][]): BundleBuyer[];
  /** Keeps a launcher's own key for a launch; refuses a wallet LaunchSeeds already holds. */
  rememberDeployer?(keypair: Keypair, name: string): void;
  /** Deletes a launcher's key from the wallet store. */
  forgetWallet?(name: string): void;
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
    x?: string;
    telegram?: string;
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
      /** The wallet the SOL came from (the launcher, when paid from a wallet). */
      sender?: string;
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
    /** Sniper-protection bundle bought by LaunchSeeds's capital (lamports). */
    bundleLamports?: number | null;
    /** Holder-reward coins: creator fees to this wallet instead of to holders. */
    feesTo?: string | null;
  }): Promise<
    | { intent: string; mintSignerRef: string; marketMaker?: string }
    | { wait: string; mintSignerRef: string }
  >;
  executeDeployment(intent: string): Promise<{
    status: "pending" | "confirmed" | "expired";
    signature: string;
    mint: string;
  }>;
  /** Must prove the old transaction cannot execute before signing a replacement. */
  refreshDeployment?(intent: string): Promise<string>;
}

/** The default description, unless the launcher wrote one; the website stays
 * empty unless the launcher set one (the coin's LaunchSeeds page is used then). */
export function withLaunchDefaults(raw: LaunchInput): LaunchInput {
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  const website = typeof raw.website === "string" ? raw.website.trim() : "";
  return { ...raw, description: description || DESCRIPTION, website };
}

/** Private launch-status handle: unguessable while the CA is secret, and
 * public-safe once the token is live (everything is public by then). */
export function launchHandle(mint: string): string {
  return createHash("sha256")
    .update(`launchseeds-launch:${mint}`)
    .digest("hex")
    .slice(0, 32);
}

/** Wallets of a prepared launch; only `preparing` launches lack them. */
function preparedWallets(token: Token) {
  if (!token.fundingWallet || !token.rewardWallet)
    throw new Error("Launch is not prepared");
  return {
    fundingWallet: token.fundingWallet,
    rewardWallet: token.rewardWallet,
  };
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
    deployerKey?: string,
  ) {
    if (!this.provider) throw new Error("Launch service is not configured");
    if (settings.userBatches && !this.provider.userBatches) throw new ApiError("User-funded batches are not enabled on this deployment.",503);
    const input = launchInput.parse(withLaunchDefaults(raw));
    if (!/^[a-f0-9]{64}$/.test(capability))
      throw new Error("Invalid launch key");
    const launchSettingsJson = canonicalLaunchSettings(settings);
    const deployer = deployerKey ? deployerKeypair(deployerKey) : null;
    // The key leaves the wallet store after launch, so nothing later may need it.
    if (deployer && (!settings.userBatches || !settings.feesTo || !this.provider.rememberDeployer))
      throw new ApiError("Deploying from your wallet needs funded columns and a creator-fee wallet.", 400);
    const deployerName = deployer ? ownDeployerName(deployer.publicKey.toBase58()) : null;
    // Sniper protection is bought by LaunchSeeds's capital, not by a dev buy.
    if (settings.bundleLamports && solToLamports(input.devBuySol) > 0)
      throw new Error(
        "A launch with sniper protection has no separate launch buy",
      );
    // A reward-fund buy comes from the market-making wallet of a holders' coin.
    if (settings.feesTo && solToLamports(input.devBuySol) > 0)
      throw new Error("A coin whose fees go to a wallet has no reward fund");
    const accessHash = hash(capability),
      requestHash = hash(
        JSON.stringify({ input, settingsJson: launchSettingsJson, ...(deployerName ? { deployerName } : {}) }),
      );
    const existingId = this.existing(accessHash, requestHash);
    let tokenId = existingId;
    if (tokenId === null) {
      validateSchedule(settings);
      this.provider.checkProtectionBudget?.(
        settings.userBatches ? null : settings.bundleLamports,
        typeof tokenId === "number" ? tokenId : undefined,
      );
      const walletBusy = () => new ApiError("This wallet has a launch in progress. Wait for it to finish.", 409);
      if (deployerName && deployerInUse(this.store.repo, deployerName)) throw walletBusy();
      if (deployer) this.provider.rememberDeployer!(deployer, deployerName!);
      // A lost race leaves only an unused, unfunded mint key behind.
      const mint = this.provider.createMint();
      tokenId = this.store.repo.tx((tx) => {
        const raced = tx.tokens.getByAccess(accessHash);
        if (raced) {
          if (raced.requestHash !== requestHash)
            throw new Error("Launch key already used for another request");
          return raced.id;
        }
        if (deployerName && deployerInUse(tx, deployerName)) throw walletBusy();
        return tx.tokens.insert({
          handle: launchHandle(mint.mint),
          mint: null,
          mintSignerRef: mint.mintSignerRef,
          name: input.name,
          symbol: input.symbol,
          description: input.description,
          image: input.image,
          metadataUri: null,
          website: input.website || coinWebsite(mint.mint),
          x: input.x,
          telegram: input.telegram,
          fundingWallet: null,
          fundingWalletName: deployerName,
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
  private scheduledBuyers(
    token: Token,
    settings = storedLaunchSettings(token.launchSettingsJson),
  ) {
    if (settings.scheduledAt === null) return [];
    if (!this.provider?.planBuyers || !token.mintSignerRef)
      throw new Error("Scheduled launch planning is not configured");
    if (settings.publishMint && !reservedMint(token)) throw new Error("Reserved mint is unavailable; do not fund this plan");
    if (settings.userBatches) {
      if (!this.provider.planColumns) throw new Error("Column launches are not configured");
      const layout = allocateUserBatches(settings.userBatches, settings.scheduledAt);
      const tranches = allocateTranches(settings.userBatches, settings.scheduledAt);
      const buyers = this.provider.planColumns({ id: token.id, mintSignerRef: token.mintSignerRef, fundingWallet: token.fundingWallet }, layout.map((column) => column.budgets), tranches.map((t) => t.budgets));
      const proceeds = settings.userBatches.proceedsWallet;
      if (buyers.some((buyer) => buyer.wallet === proceeds) || (proceeds === token.fundingWallet && !isOwnDeployer(token.fundingWalletName)))
        throw new ApiError("Choose an external proceeds wallet, not a launch or buyer wallet.", 400);
      return buyers;
    }
    return this.provider.planBuyers(token.mintSignerRef, allocatedBudget(BigInt(settings.bundleLamports!), settings.walletSharesBps!));
  }
  private saveScheduledPlan(token:Token,settings=storedLaunchSettings(token.launchSettingsJson)) {
    if(settings.scheduledAt===null)return;
    const buyers=this.scheduledBuyers(token,settings);
    this.store.repo.scheduledPlans.save({
      tokenId: token.id,
      buyersJson: JSON.stringify(buyers),
      planHash: hash(
        JSON.stringify(scheduledCommitment(token, settings, buyers)),
      ),
      createdAt: Date.now(),
    });
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
      this.provider.checkProtectionBudget?.(
        protectionAmount(storedLaunchSettings(claimed.launchSettingsJson)),
      );
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
      // The launcher pays the sniper-protection fee (3% of the bundle) on top.
      if (storedLaunchSettings(claimed.launchSettingsJson).publishMint && reservedMint({mintSignerRef:prepared.mintSignerRef}) !== reservedMint(claimed)) throw new Error("Preparation changed the reserved CA; do not fund");
      const choices=storedLaunchSettings(claimed.launchSettingsJson);
      if(choices.userBatches){
        if(!this.provider.userBatches||!this.provider.validateUserBatchLayout)throw Error("Batch validation is not configured");
        const token={...claimed,fundingWallet:prepared.fundingWallet};
        await this.provider.validateUserBatchLayout({token,fundingWallet:prepared.fundingWallet,metadataUri:prepared.metadataUri,buyers:this.scheduledBuyers(token,choices),settings:choices});
      }
      const requiredLamports =
        prepared.requiredLamports +
        launchSupplement(storedLaunchSettings(claimed.launchSettingsJson));
      this.provider.checkProtectionBudget?.(
        protectionAmount(storedLaunchSettings(claimed.launchSettingsJson)),
      );
      return this.store.repo.tx((tx) => {
        const t = tx.tokens.get(tokenId);
        if (!t || t.leaseId !== leaseId || t.status !== "preparing")
          return false;
        const schedule = storedLaunchSettings(t.launchSettingsJson).scheduledAt;
        if (schedule !== null && schedule <= Date.now())
          throw new ApiError(
            "The chosen launch time passed during preparation. Choose a later time.",
            409,
          );
        this.provider!.checkProtectionBudget?.(
          protectionAmount(storedLaunchSettings(t.launchSettingsJson)),
          t.id,
        );
        this.saveScheduledPlan(t);
        const state = tx.operations.state(tokenId);
        if (
          !state &&
          storedLaunchSettings(t.launchSettingsJson).scheduledAt === null
        )
          throw new Error("Initial strategy missing");
        return tx.tokens.markPrepared(tokenId, {
          fundingWallet: prepared.fundingWallet,
          fundingWalletName: prepared.fundingWalletName,
          creatorWallet: prepared.rewardWallet,
          rewardWallet: prepared.rewardWallet,
          mintSignerRef: prepared.mintSignerRef,
          metadataUri: prepared.metadataUri,
          requiredLamports: String(requiredLamports),
          devBuyLamports: String(devBuyLamports),
          quoteExpiresAt: Math.min(
            now + 30 * 60_000,
            storedLaunchSettings(t.launchSettingsJson).scheduledAt ?? Infinity,
          ),
          activeStrategyId: state?.initialStrategyId ?? null,
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
    firstStrategy: StrategyConfigValue | null,
  ) {
    if (!this.provider || !/^[a-f0-9]{64}$/.test(capability))
      throw new ApiError("Invalid launch amendment", 401);
    if(settings.userBatches&&!this.provider.userBatches)throw new ApiError("User-funded batches are not enabled on this deployment.",503);
    const input = launchInput.parse(withLaunchDefaults(raw));
    const launchSettingsJson = canonicalLaunchSettings(settings);
    validateSchedule(settings);
    const leaseId = crypto.randomUUID();
    const now = Date.now();
    const token = this.store.repo.tx((tx) => {
      const token = tx.tokens.getByHandle(handle);
      if (!token || token.accessHash !== hash(capability))
        throw new Error("Not found");
      if (tx.freeLaunches.byToken(token.id))
        throw new ApiError(
          "A sponsorship payment is already prepared. Token details are locked.",
          409,
        );
      if (
        token.status !== "funding" ||
        token.fundingReceivedLamports !== "0" ||
        tx.deposits.sumLamports(token.id) !== 0n
      )
        throw new ApiError(
          "This launch is already funded or being deployed",
          409,
        );
      if (token.leaseUntil > now)
        throw new ApiError("Another launch operation is in progress", 409);
      tx.tokens.updateLaunch(token.id, {
        leaseId,
        leaseUntil: now + LaunchService.PREPARATION_LEASE_MS,
      });
      return token;
    });
    const tokenId = token.id;
    const wallets = preparedWallets(token);
    try {
      const verifyUnfunded = async () => {
        // An own wallet may hold SOL already; only a full balance counts as paid.
        if (
          !isOwnDeployer(token.fundingWalletName) &&
          this.provider!.hasIncomingFunds &&
          (await this.provider!.hasIncomingFunds(wallets.fundingWallet))
        ) {
          throw new ApiError(
            "A payment is already arriving. Token details are locked.",
            409,
          );
        }
        const deposits = await this.provider!.deposits(
          tokenId,
          wallets.fundingWallet,
        );
        if (deposits.some((deposit) => deposit.lamports > 0))
          throw new ApiError(
            "A payment has been detected. Token details are now locked.",
            409,
          );
      };
      await verifyUnfunded();
      this.provider.checkProtectionBudget?.(
        settings.userBatches ? null : settings.bundleLamports,
        typeof tokenId === "number" ? tokenId : undefined,
      );
      const devBuyLamports = solToLamports(input.devBuySol);
      const prepared = await this.provider.prepare({
        tokenId,
        ...input,
        devBuyLamports,
        refreshMetadata: true,
        fundingWalletName: token.fundingWalletName,
        mintSignerRef: token.mintSignerRef,
      });
      if (
        (settings.publishMint && prepared.mintSignerRef !== token.mintSignerRef) ||
        prepared.fundingWallet !== wallets.fundingWallet ||
        prepared.rewardWallet !== wallets.rewardWallet ||
        prepared.requiredLamports <= devBuyLamports ||
        !prepared.metadataUri
      )
        throw new ApiError(
          "Revised launch quote changed wallet identity or lacks metadata",
          503,
        );
      await verifyUnfunded();
      this.provider.checkProtectionBudget?.(
        settings.userBatches ? null : settings.bundleLamports,
        typeof tokenId === "number" ? tokenId : undefined,
      );
      const canonical = firstStrategy ? canonicalStrategy(firstStrategy) : null;
      if(settings.userBatches){
        if(!this.provider.userBatches||!this.provider.validateUserBatchLayout)throw Error("Batch validation is not configured");
        const revised={...token,...input,launchSettingsJson};
        await this.provider.validateUserBatchLayout({token:revised,fundingWallet:prepared.fundingWallet,metadataUri:prepared.metadataUri,buyers:this.scheduledBuyers(revised,settings),settings});
        await verifyUnfunded();
      }
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (
          !current ||
          current.leaseId !== leaseId ||
          current.status !== "funding" ||
          current.fundingReceivedLamports !== "0" ||
          tx.deposits.sumLamports(tokenId) !== 0n
        )
          throw new ApiError("Launch changed during amendment", 409);
        const state = tx.operations.state(tokenId);
        if (settings.scheduledAt === null && !canonical)
          throw new Error("Initial strategy missing");
        if (canonical) {
          const { config, configKey, configJson } = canonical;
          if (!state) throw new Error("Initial strategy missing");
          const initial = tx.strategies.getOrCreate({
            tokenId,
            type: config.type,
            configKey,
            configJson,
            enabled: true,
            createdAt: Date.now(),
          });
          tx.operations.updateState(tokenId, {
            initialStrategyId: initial.id,
            switchedAt: Date.now(),
          });
          tx.tokens.setGovernance(tokenId, {
            activeStrategyId: initial.id,
            leaderStrategyId: null,
            leaderSince: null,
          });
        }
        this.provider!.checkProtectionBudget?.(
          settings.userBatches ? null : settings.bundleLamports,
          current.id,
        );
        this.saveScheduledPlan(
          { ...current, ...input, launchSettingsJson },
          settings,
        );
        tx.tokens.updateUnfundedDetails(tokenId, {
          name: input.name,
          symbol: input.symbol,
          description: input.description,
          image: input.image,
          website:
            input.website ||
            coinWebsite(
              token.mint ?? token.mintSignerRef!.replace(/^launchseeds-mint-/, ""),
            ),
          x: input.x || "",
          telegram: input.telegram || "",
          metadataUri: prepared.metadataUri,
          requiredLamports: String(
            prepared.requiredLamports +
              launchSupplement(storedLaunchSettings(launchSettingsJson)),
          ),
          devBuyLamports: String(devBuyLamports),
          launchSettingsJson,
          // A revised quote gets a fresh 30-minute window, like a new one.
          quoteExpiresAt: Math.min(
            Date.now() + 30 * 60_000,
            settings.scheduledAt ?? Infinity,
          ),
        });
        tx.tokens.updateLaunch(tokenId, {
          inputJson: JSON.stringify(input),
          requestHash: hash(
            JSON.stringify({ input, settingsJson: launchSettingsJson }),
          ),
          leaseId: "",
          leaseUntil: 0,
          error: null,
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
    if (!token || token.accessHash !== hash(capability))
      throw new Error("Not found");
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
    if (!token || !tokenVisible(token)) throw new Error("Not found");
    const live = token.status === "live";
    return {
      handle: token.handle,
      description: token.description,
      website: token.website,
      x: token.x,
      telegram: token.telegram,
      status: token.status,
      name: token.name,
      symbol: token.symbol,
      fundingWallet: token.fundingWallet || "",
      requiredLamports: safeNumber(token.requiredLamports),
      receivedLamports: safeNumber(token.fundingReceivedLamports),
      // New plans publish only the reserved public address, never the signer.
      mint: live || storedLaunchSettings(token.launchSettingsJson).publishMint ? reservedMint(token) ?? "" : "",
      launchSignature: token.deploySignature || "",
      settings: storedLaunchSettings(token.launchSettingsJson),
      plan: this.store.repo.scheduledPlans.byToken(tokenId)
        ? publicScheduledPlan(
            this.store,
            this.store.repo.scheduledPlans.byToken(tokenId)!.planHash,
          )
        : null,
      // Funding address and amount are valid until this time (countdown on the pay step).
      expiresAt: token.quoteExpiresAt,
      devBuyLamports: safeNumber(token.devBuyLamports),
      rewardFundVerified: Boolean(
        live &&
        token.rewardWallet &&
        BigInt(token.devBuyLamports) > 0n &&
        BigInt(
          this.store.repo.holders.get(tokenId, token.rewardWallet)
            ?.balanceRaw ?? "0",
        ) > 0n,
      ),
      error: token.error
        ? "Launch needs operator attention. Do not send more funds."
        : "",
    };
  }
  async process(tokenId: number) {
    if (!this.provider) throw new Error("Launch service is not configured");
    const leaseId = randomUUID();
    const acquired = this.store.repo.tx((tx) => {
      const current = tx.tokens.get(tokenId);
      if (
        !current ||
        !["funding", "deploying"].includes(current.status) ||
        current.leaseUntil > Date.now()
      )
        return false;
      tx.tokens.updateLaunch(tokenId, {
        leaseId,
        leaseUntil: Date.now() + LaunchService.PREPARATION_LEASE_MS,
      });
      return true;
    });
    if (!acquired) return;
    const assertLease = () => {
      const current = this.store.repo.tokens.get(tokenId);
      if (current?.leaseId !== leaseId || current.leaseUntil <= Date.now())
        throw new Error(
          "Launch processing lease lost; reconcile persisted intent",
        );
    };
    const heartbeat = setInterval(() => {
      const current = this.store.repo.tokens.get(tokenId);
      if (current?.leaseId === leaseId && current.leaseUntil > Date.now())
        this.store.repo.tokens.updateLaunch(tokenId, {
          leaseUntil: Date.now() + LaunchService.PREPARATION_LEASE_MS,
        });
    }, 10_000);
    heartbeat.unref();
    try {
      await this.processLeased(tokenId, assertLease);
    } finally {
      clearInterval(heartbeat);
      this.store.repo.tx((tx) => {
        if (tx.tokens.get(tokenId)?.leaseId === leaseId)
          tx.tokens.updateLaunch(tokenId, { leaseId: "", leaseUntil: 0 });
      });
    }
  }
  /** Deletes each launcher key no launch needs any more; launches that missed
   * their time expire first, so they can never run without it. */
  /** A launch whose bundle expired well after its launch time stops here instead
   * of rebuilding forever: nothing landed, so nothing exists on chain, and its
   * funds stay in the launch wallet. Its columns are skipped. */
  giveUpExpired(tokenId: number, now = Date.now()) {
    const token = this.store.repo.tokens.get(tokenId);
    const schedule = token ? storedLaunchSettings(token.launchSettingsJson).scheduledAt : null;
    if (!token || schedule === null || now <= schedule + LAUNCH_GIVE_UP_MS) return false;
    return this.store.repo.tx((tx) => {
      if (!tx.tokens.transition(tokenId, "deploying", "failed", { error: "The launch did not land in time. Nothing was created on chain, and the funds are still in the launch wallet." })) return false;
      for (const row of tx.userBatches.byToken(tokenId)) {
        const state = JSON.parse(row.stateJson);
        tx.userBatches.save(row.id, row.revision, JSON.stringify({ ...state, status: "skipped", error: "Launch never landed" }), now);
      }
      return true;
    });
  }
  forgetFinishedDeployers(now = Date.now()) {
    const forget = this.provider?.forgetWallet?.bind(this.provider);
    if (!forget) return;
    const repo = this.store.repo;
    const tokens = repo.tokens.all().filter((t) => isOwnDeployer(t.fundingWalletName));
    for (const token of tokens)
      if (token.status === "funding" && !needsDeployer(repo, token, now)) repo.tokens.expireFunding(token.id);
    for (const name of new Set(tokens.map((t) => t.fundingWalletName!)))
      if (!deployerInUse(repo, name, now)) forget(name);
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
        // The wallet that paid first is the launcher: it may close the coin's
        // sniper protection from the coin page.
        const first = [...deposits]
          .sort((a, b) => a.confirmedSlot - b.confirmedSlot)
          .find((d) => d.sender);
        if (first?.sender) tx.tokens.recordLauncher(tokenId, first.sender);
        tx.tokens.update(tokenId, {
          fundingReceivedLamports: tx.deposits.sumLamports(tokenId).toString(),
        });
      });
      token = this.store.repo.tokens.get(tokenId)!;
      if (
        BigInt(token.fundingReceivedLamports) < BigInt(token.requiredLamports)
      )
        return;
      const schedule = storedLaunchSettings(
        token.launchSettingsJson,
      ).scheduledAt;
      if (schedule !== null) {
        const paid = this.store.repo.deposits.listByToken(tokenId);
        if (Date.now() < schedule) return;
        const deadline = Math.min(schedule, token.quoteExpiresAt ?? schedule);
        const onTime = paid
          .filter((d) => d.confirmedAt <= deadline)
          .reduce((sum, d) => sum + BigInt(d.lamports), 0n);
        if (onTime < BigInt(token.requiredLamports)) {
          this.store.repo.tokens.updateLaunch(tokenId, {
            error:
              "Scheduled time missed: payment was not confirmed in time. Operator refund review required.",
          });
          return;
        }
      }
      const prepared = await provider.prepareDeployment({
        tokenId,
        fundingWallet,
        metadataUri: token.metadataUri!,
        name: token.name,
        symbol: token.symbol,
        devBuyLamports: safeNumber(token.devBuyLamports),
        mintSignerRef: token.mintSignerRef,
        holderRewards: storedLaunchSettings(token.launchSettingsJson)
          .holderRewards,
        bundleLamports: storedLaunchSettings(token.launchSettingsJson)
          .bundleLamports,
        feesTo: storedLaunchSettings(token.launchSettingsJson).feesTo,
      });
      assertLease();
      // Sniper-protection capital is being freed (an earlier coin is selling): next round.
      if ("wait" in prepared) {
        this.store.repo.tokens.updateLaunch(tokenId, {
          error: prepared.wait.slice(0, 500),
        });
        return;
      }
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId)!;
        if (current.status !== "funding") return;
        tx.tokens.updateLaunch(tokenId, {
          intent: prepared.intent,
          error: null,
        });
        tx.tokens.update(tokenId, { mintSignerRef: prepared.mintSignerRef });
        // The public market-making wallet receives the launch buy.
        if (prepared.marketMaker)
          tx.tokens.assignMarketMaker(tokenId, prepared.marketMaker);
        tx.tokens.transition(tokenId, "funding", "deploying");
      });
    }
    const intent = this.store.repo.tokens.get(tokenId)?.intent;
    if (!intent) throw new Error("Missing persisted launch intent");
    assertLease();
    let result = await provider.executeDeployment(intent);
    assertLease();
    if (result.status === "expired" && this.giveUpExpired(tokenId)) return;
    if (result.status === "expired") {
      if (!provider.refreshDeployment)
        throw new Error("Launch intent expired; reconciliation required");
      const replacement = await provider.refreshDeployment(intent);
      assertLease();
      const stored = this.store.repo.tx((tx) => {
        const current = tx.tokens.get(tokenId);
        if (current?.status !== "deploying" || current.intent !== intent)
          return false;
        tx.tokens.updateLaunch(tokenId, { intent: replacement, error: null });
        tx.tokens.update(tokenId, { deploySignature: null });
        return true;
      });
      if (!stored) return;
      result = await provider.executeDeployment(replacement);
      assertLease();
    }
    if (result.status === "pending")
      this.store.repo.tokens.update(tokenId, {
        deploySignature: result.signature,
      });
    if (result.status === "confirmed")
      this.store.repo.tx((tx) => {
        if (
          !tx.tokens.transition(tokenId, "deploying", "live", {
            mint: result.mint,
            deploySignature: result.signature,
            launchedAt: Date.now(),
          })
        )
          return;
        // A holder-reward coin's treasury is its public market-making wallet: the
        // fixed sell plan's profit is spent from there on the coin's strategy.
        const live = tx.tokens.get(tokenId)!;
        if (
          storedLaunchSettings(live.launchSettingsJson).holderRewards &&
          live.devBuyRecipient
        )
          tx.tokens.adoptMarketMakerTreasury(tokenId, {
            rewardWallet: live.devBuyRecipient,
            fundingWalletName: marketMakerWalletName(result.mint),
          });
      });
  }
}

/** How long past its launch time a launch keeps rebuilding a bundle that expired. */
export const LAUNCH_GIVE_UP_MS = 15 * 60_000;
export function validateSchedule(settings: LaunchSettings, now = Date.now()) {
  if (settings.feesTo) {
    try { new PublicKey(settings.feesTo); }
    catch { throw new ApiError("Enter a valid creator-fee address.",400); }
  }
  if (settings.profitPolicy?.mode === "wallet") {
    try {
      new PublicKey(settings.profitPolicy.wallet);
    } catch {
      throw new ApiError("Enter a valid profit wallet.", 400);
    }
  }
  if (settings.scheduledAt === null) return;
  if (
    settings.scheduledAt < now + 120_000 ||
    settings.scheduledAt > now + 7 * 86_400_000
  )
    throw new ApiError(
      "Choose a launch time between 2 minutes and 7 days from now.",
      400,
    );
  if (settings.userBatches) {
    allocateUserBatches(settings.userBatches, settings.scheduledAt);
    allocateTranches(settings.userBatches, settings.scheduledAt);
    try { new PublicKey(settings.userBatches.proceedsWallet); } catch { throw new ApiError("Enter a valid proceeds wallet.", 400); }
  } else allocatedBudget(BigInt(settings.bundleLamports!), settings.walletSharesBps!);
}

function protectionAmount(settings: LaunchSettings) { return settings.userBatches ? null : settings.bundleLamports; }
export function launchSupplement(settings: LaunchSettings) {
  if (!settings.userBatches) return bundleFeeLamports(settings.bundleLamports);
  // Tranche SOL stays in the deposit wallet after the launch, until each fires.
  return Number(userBatchFunding({totalBuy:BigInt(settings.bundleLamports!),walletCount:batchWalletCount(settings.userBatches),baseFee:0n,serviceFee:0n,reservePerWallet:BigInt(BUYER_RESERVE_LAMPORTS),bundleTip:BigInt(JITO_TIP_LAMPORTS)}).required
    + trancheFunding(settings.userBatches, BigInt(BUYER_RESERVE_LAMPORTS)));
}
