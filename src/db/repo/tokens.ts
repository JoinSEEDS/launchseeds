import type { Token, LaunchStatusValue } from "../schema";
import { schemas } from "../schema";
import {
  record,
  records,
  patchByUid,
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

export function tokenRepo(db: SqlDb) {
  return {
    insert(input: Token) {
      db.tokens.insert(schemas.tokens.parse(input));
    },
    get(uid: string) {
      return record(db, "tokens", "uid = ?", uid);
    },
    getByMint(mint: string) {
      return record(db, "tokens", "mint = ?", mint);
    },
    getByFundingWallet(wallet: string) {
      return record(db, "tokens", "fundingWallet = ?", wallet);
    },
    listLive(args: PageArgs) {
      const result = selectPage<Record<string, unknown>>(
        db,
        "SELECT * FROM tokens WHERE status = 'live' ORDER BY launchedAt DESC, uid DESC",
        [],
        args,
      );
      return {
        ...result,
        items: result.items.map((x) => schemas.tokens.parse(x)),
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
      uid: string,
      from: LaunchStatusValue | LaunchStatusValue[],
      to: LaunchStatusValue,
      patch: Partial<Token> = {},
    ) {
      return transition(db, "tokens", uid, from, to, patch, PATCH);
    },
    update(uid: string, patch: Partial<Token>) {
      return patchByUid(db, "tokens", uid, patch, PATCH);
    },
    setGovernance(
      uid: string,
      state: Pick<
        Token,
        "activeStrategyId" | "leaderStrategyId" | "leaderSince"
      >,
    ) {
      return patchByUid(db, "tokens", uid, state, [
        "activeStrategyId",
        "leaderStrategyId",
        "leaderSince",
      ]);
    },
    setMarket(uid: string, data: Pick<Token, "priceUsd" | "marketCapUsd">) {
      return patchByUid(db, "tokens", uid, data, ["priceUsd", "marketCapUsd"]);
    },
  };
}
