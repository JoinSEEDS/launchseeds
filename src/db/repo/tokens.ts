import type { Token, NewRows, LaunchStatusValue } from "../schema";
import { schemas } from "../schema";
import {
  record,
  records,
  patchById,
  transition,
  selectPage,
  type PageArgs,
  type SqlDb,
} from "./util";

const PATCH = [
  "mint",
  "mintSignerRef",
  "metadataUri",
  "fundingReceivedLamports",
  "deploySignature",
  "feeConfigSignature",
  "nextAttemptAt",
  "error",
  "launchedAt",
  "refundWallet",
] as const;
/** Launch-request fields merged into the token row (lease, retries, inputs). */
const LAUNCH_PATCH = [
  "leaseId",
  "leaseUntil",
  "attempts",
  "intent",
  "error",
  "metadataUri",
  "mintSignerRef",
  "inputJson",
  "requestHash",
  "launchSettingsJson",
] as const;
/** Wallets, quote and metadata recorded when preparation completes. */
const PREPARED_PATCH = [
  "fundingWallet",
  "fundingWalletName",
  "creatorWallet",
  "rewardWallet",
  "mintSignerRef",
  "metadataUri",
  "requiredLamports",
  "devBuyLamports",
  "quoteExpiresAt",
  "activeStrategyId",
  "leaseId",
  "leaseUntil",
  "error",
] as const;

export function tokenRepo(db: SqlDb) {
  return {
    setSnapshot(id: number, slot: number) {
      return patchById(db, "tokens", id, { holdersSnapshotSlot: slot }, [
        "holdersSnapshotSlot",
      ]);
    },
    all() {
      return records(db, "tokens", "1=1 ORDER BY createdAt DESC");
    },
    /** Returns the new row id. */
    insert(input: NewRows["tokens"]): number {
      return db.tokens.insert(schemas.tokens.parse(input)).id;
    },
    get(id: number) {
      return record(db, "tokens", "id = ?", id);
    },
    getByMint(mint: string) {
      return record(db, "tokens", "mint = ?", mint);
    },
    getByHandle(handle: string) {
      return record(db, "tokens", "handle = ?", handle);
    },
    getByAccess(accessHash: string) {
      return record(db, "tokens", "accessHash = ?", accessHash);
    },
    getByFundingWallet(wallet: string) {
      return record(db, "tokens", "fundingWallet = ?", wallet);
    },
    /** Launches whose wallets and metadata are not prepared yet. */
    preparing() {
      return records(db, "tokens", "status = 'preparing' ORDER BY createdAt");
    },
    listLive(args: PageArgs) {
      const result = selectPage<Record<string, unknown>>(
        db,
        "SELECT * FROM tokens WHERE status = 'live' ORDER BY launchedAt DESC, id DESC",
        [],
        args,
      );
      return {
        ...result,
        items: result.items.map((x) => ({
          ...schemas.tokens.parse(x),
          id: Number(x.id),
        })),
      };
    },
    search(query: string, limit = 20) {
      const q = query.trim();
      return records(
        db,
        "tokens",
        "status = 'live' AND (symbol LIKE ? OR name LIKE ? OR mint = ?) ORDER BY launchedAt DESC LIMIT ?",
        `${q}%`,
        `${q}%`,
        q,
        Math.min(100, Math.max(1, limit)),
      );
    },
    due(statuses: LaunchStatusValue[], now: number, limit = 30) {
      if (!statuses.length) return [];
      return records(
        db,
        "tokens",
        `status IN (${statuses.map(() => "?").join(",")}) AND nextAttemptAt <= ? ORDER BY nextAttemptAt LIMIT ?`,
        ...statuses,
        now,
        limit,
      );
    },
    transition(
      id: number,
      from: LaunchStatusValue | LaunchStatusValue[],
      to: LaunchStatusValue,
      patch: Partial<Token> = {},
    ) {
      return transition(db, "tokens", id, from, to, patch, PATCH);
    },
    update(id: number, patch: Partial<Token>) {
      return patchById(db, "tokens", id, patch, PATCH);
    },
    /** Holder-reward launch: the public market-making wallet that makes the launch buy. */
    assignMarketMaker(id: number, address: string) {
      return patchById(db, "tokens", id, { devBuyRecipient: address }, ["devBuyRecipient"]);
    },
    /** Holder-reward coin gone live: its market-making wallet becomes the treasury. */
    adoptMarketMakerTreasury(id: number, patch: { rewardWallet: string; fundingWalletName: string }) {
      return patchById(db, "tokens", id, patch, ["rewardWallet", "fundingWalletName"]);
    },
    /** Preparation lease, retry counters and stored launch inputs. */
    updateLaunch(id: number, patch: Partial<Token>) {
      return patchById(db, "tokens", id, patch, LAUNCH_PATCH);
    },
    /** preparing → funding once wallets, metadata and quote exist. */
    markPrepared(id: number, patch: Partial<Token>) {
      return transition(db, "tokens", id, "preparing", "funding", patch, PREPARED_PATCH);
    },
    setGovernance(
      id: number,
      state: Pick<
        Token,
        "activeStrategyId" | "leaderStrategyId" | "leaderSince"
      >,
    ) {
      return patchById(db, "tokens", id, state, [
        "activeStrategyId",
        "leaderStrategyId",
        "leaderSince",
      ]);
    },
    /** Update only a still-unfunded launch. Must run within the caller's repo.tx. */
    updateUnfundedDetails(id: number, patch: Pick<Token,
      "name" | "symbol" | "description" | "image" | "website" | "x" | "telegram" |
      "metadataUri" | "requiredLamports" | "devBuyLamports" | "launchSettingsJson" | "quoteExpiresAt"
    >) {
      const t = this.get(id);
      if (!t || t.status !== "funding" || t.fundingReceivedLamports !== "0")
        throw new Error("Launch details can only change before funding");
      return patchById(db, "tokens", id, patch, [
        "name", "symbol", "description", "image", "website", "x", "telegram",
        "metadataUri", "requiredLamports", "devBuyLamports", "launchSettingsJson",
        "quoteExpiresAt",
      ]);
    },
    setMarket(id: number, data: Pick<Token, "priceUsd" | "marketCapUsd">) {
      return patchById(db, "tokens", id, data, ["priceUsd", "marketCapUsd"]);
    },
  };
}
