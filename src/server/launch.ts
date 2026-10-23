import { DESCRIPTION } from "../../lib/strategy";
import { Store, safeNumber } from "./store";
import {
  hash,
  launchInput,
  safeInteger,
  solToLamports,
  type LaunchInput,
} from "../shared/domain";
export interface LaunchProvider {
  prepare(input: {
    uid: string;
    name: string;
    symbol: string;
    description: string;
    image: string;
    website: string;
    devBuyLamports: number;
  }): Promise<{
    fundingWallet: string;
    rewardWallet: string;
    metadataUri: string;
    requiredLamports: number;
  }>;
  deposits(
    tokenUid: string,
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
    uid: string;
    fundingWallet: string;
    metadataUri: string;
    name: string;
    symbol: string;
    devBuyLamports: number;
  }): Promise<{ intent: string }>;
  executeDeployment(intent: string): Promise<{
    status: "pending" | "confirmed";
    signature: string;
    mint: string;
  }>;
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
    onCreated?: (uid: string) => void,
  ) {
    if (!this.provider) throw new Error("Launch service is not configured");
    const input = launchInput.parse({ ...raw, description: DESCRIPTION });
    if (!/^[a-f0-9]{64}$/.test(capability))
      throw new Error("Invalid launch key");
    const accessHash = hash(capability),
      requestHash = hash(JSON.stringify(input));
    const uid = this.store.repo.tx((tx) => {
      const existing = tx.operations.launchByAccess(accessHash);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new Error("Launch key already used for another request");
        return existing.uid;
      }
      const uid = crypto.randomUUID();
      tx.operations.insertLaunch({
        uid,
        accessHash,
        requestHash,
        inputJson: JSON.stringify(input),
        createdAt: Date.now(),
      });
      return uid;
    });
    // Persist strategy before publishing a funding destination. Also valid before a token exists.
    onCreated?.(uid);
    await this.resumePreparation(uid);
    return this.status(uid, capability);
  }
  async resumePreparation(uid: string, now = Date.now()) {
    if (!this.provider || this.store.repo.tokens.get(uid)) return false;
    const leaseId = crypto.randomUUID();
    const claimed = this.store.repo.tx((tx) => {
      const r = tx.operations.launch(uid);
      if (!r || r.leaseUntil > now) return false;
      tx.operations.updateLaunch(uid, {
        leaseId,
        leaseUntil: now + LaunchService.PREPARATION_LEASE_MS,
        attempts: r.attempts + 1,
        error: "",
      });
      return r;
    });
    if (!claimed) return false;
    const input = launchInput.parse(JSON.parse(claimed.inputJson));
    try {
      const devBuyLamports = solToLamports(input.devBuySol);
      const prepared = await this.provider.prepare({
        uid,
        ...input,
        devBuyLamports,
      });
      safeInteger(prepared.requiredLamports);
      if (prepared.requiredLamports <= devBuyLamports || !prepared.metadataUri)
        throw new Error("Invalid launch preparation");
      return this.store.repo.tx((tx) => {
        const r = tx.operations.launch(uid);
        if (!r || r.leaseId !== leaseId || tx.tokens.get(uid)) return false;
        const state = tx.operations.state(uid);
        if (!state) throw new Error("Initial strategy missing");
        tx.tokens.insert({
          uid,
          mint: null,
          mintSignerRef: null,
          name: input.name,
          symbol: input.symbol,
          description: input.description,
          image: input.image,
          website: input.website,
          x: input.x,
          telegram: input.telegram,
          metadataUri: prepared.metadataUri,
          fundingWallet: prepared.fundingWallet,
          fundingWalletName: `launchseeds-${uid}`,
          creatorWallet: prepared.rewardWallet,
          rewardWallet: prepared.rewardWallet,
          launcherWallet: null,
          devBuyRecipient: null,
          refundWallet: null,
          requiredLamports: String(prepared.requiredLamports),
          devBuyLamports: String(devBuyLamports),
          quoteExpiresAt: now + 30 * 60_000,
          fundingReceivedLamports: "0",
          status: "funding",
          deploySignature: null,
          feeConfigSignature: null,
          nextAttemptAt: 0,
          error: null,
          activeStrategyId: state.initialStrategyId,
          leaderStrategyId: null,
          leaderSince: null,
          tokenDecimals: 6,
          priceUsd: 0,
          marketCapUsd: 0,
          lastGravityMinute: null,
          holdersSnapshotSlot: 0,
          createdAt: claimed.createdAt,
          launchedAt: null,
        });
        tx.operations.updateLaunch(uid, { leaseId: "", leaseUntil: 0 });
        return true;
      });
    } catch (error) {
      this.store.repo.tx((tx) => {
        const current = tx.operations.launch(uid);
        if (current?.leaseId === leaseId)
          tx.operations.updateLaunch(uid, {
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
  status(uid: string, capability: string) {
    if (this.store.repo.operations.launch(uid)?.accessHash !== hash(capability))
      throw new Error("Not found");
    return this.publicStatus(uid);
  }
  publicStatus(uid: string) {
    const request = this.store.repo.operations.launch(uid);
    const token = this.store.repo.tokens.get(uid);
    if (!request && !token) throw new Error("Not found");
    const input = request
      ? launchInput.parse(JSON.parse(request.inputJson))
      : token!;
    return {
      uid,
      status: token?.status || "preparing",
      name: input.name,
      symbol: input.symbol,
      fundingWallet: token?.fundingWallet || "",
      requiredLamports: token ? safeNumber(token.requiredLamports) : 0,
      receivedLamports: token ? safeNumber(token.fundingReceivedLamports) : 0,
      mint: token?.mint || "",
      launchSignature: token?.deploySignature || "",
      error:
        request?.error || token?.error
          ? "Launch needs operator attention. Do not send more funds."
          : "",
    };
  }
  async process(uid: string) {
    if (!this.provider) throw new Error("Launch service is not configured");
    let token = this.store.repo.tokens.get(uid);
    if (!token) throw new Error("Not found");
    if (!["funding", "deploying"].includes(token.status)) return;
    if (token.status === "funding") {
      const deposits = await this.provider.deposits(uid, token.fundingWallet);
      this.store.repo.tx((tx) => {
        for (const d of deposits) {
          safeInteger(d.lamports);
          tx.deposits.record({
            uid: crypto.randomUUID(),
            tokenId: uid,
            signature: d.signature,
            lamports: String(d.lamports),
            confirmedSlot: d.confirmedSlot,
            confirmedAt: d.confirmedAt,
            refundSignature: null,
          });
        }
        tx.tokens.update(uid, {
          fundingReceivedLamports: tx.deposits.sumLamports(uid).toString(),
        });
      });
      token = this.store.repo.tokens.get(uid)!;
      if (
        BigInt(token.fundingReceivedLamports) < BigInt(token.requiredLamports)
      )
        return;
      const prepared = await this.provider.prepareDeployment({
        uid,
        fundingWallet: token.fundingWallet,
        metadataUri: token.metadataUri!,
        name: token.name,
        symbol: token.symbol,
        devBuyLamports: safeNumber(token.devBuyLamports),
      });
      this.store.repo.tx((tx) => {
        const current = tx.tokens.get(uid)!;
        if (current.status !== "funding") return;
        tx.operations.updateLaunch(uid, { intent: prepared.intent });
        tx.tokens.transition(uid, "funding", "deploying");
      });
    }
    const intent = this.store.repo.operations.launch(uid)?.intent;
    if (!intent) throw new Error("Missing persisted launch intent");
    const result = await this.provider.executeDeployment(intent);
    if (result.status === "confirmed")
      this.store.repo.tokens.transition(uid, "deploying", "live", {
        mint: result.mint,
        deploySignature: result.signature,
        launchedAt: Date.now(),
      });
  }
}
