/** Presentation/service facade. All authoritative reads and writes use src/db repositories. */
import type { openLaunchseedsData } from "../db";
import type { Token } from "../db/schema";
import {
  positive,
  safeInteger,
  validateHolders,
  type Holder,
} from "../shared/domain";
export const safeNumber = (value: string | bigint) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new Error("Amount exceeds numeric API range");
  return n;
};
export function humanToRaw(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new Error("Invalid human token quantity");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.slice(decimals).replace(/0/g, ""))
    throw new Error("Token quantity exceeds mint precision");
  return (
    BigInt(whole!) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0")
  ).toString();
}
export class Store {
  readonly repo;
  constructor(readonly data: ReturnType<typeof openLaunchseedsData>) {
    this.repo = data.repo;
  }
  close() {
    this.data.database.close();
  }
  view(token: Token) {
    const state = this.repo.operations.state(token.uid);
    const treasury = this.repo.treasuries.getByOwner(
      "token",
      token.uid,
      "USDC",
    );
    // Existing UI labels USD evidence. Never present SOL atomic balances as USDC.
    const totals = treasury
      ? this.repo.ledger.totals(treasury.uid)
      : { collected: 0n, spent: 0n };
    const reserved = treasury ? safeNumber(treasury.reservedAtomic) : 0;
    return {
      ...token,
      id: token.uid,
      mint: token.mint || "",
      fundingWallet: token.fundingWallet,
      requiredLamports: safeNumber(token.requiredLamports),
      devBuyLamports: safeNumber(token.devBuyLamports),
      receivedLamports: safeNumber(token.fundingReceivedLamports),
      launchSignature: token.deploySignature || "",
      collectedMicros: safeNumber(totals.collected),
      spentMicros: safeNumber(totals.spent),
      reservedMicros: reserved,
      holdersUpdatedAt: state?.snapshotAt || 0,
      snapshotSlot: token.holdersSnapshotSlot,
      gravityUpdatedAt: (token.lastGravityMinute ?? 0) * 60_000,
    };
  }
  token(uid: string) {
    const token = this.repo.tokens.get(uid);
    if (!token) throw new Error("Not found");
    return this.view(token);
  }
  listLive() {
    return this.repo.tokens
      .all()
      .filter((x) => x.status === "live")
      .map((x) => this.view(x));
  }
  listWork() {
    return this.repo.tokens.all().map((x) => this.view(x));
  }
  leaderboard(uid: string) {
    const token = this.repo.tokens.get(uid);
    if (!token) throw new Error("Not found");
    const all = this.repo.holders.active(uid);
    const total = this.repo.holders.totalGravity(uid);
    return {
      totalGravity: Number(total) / 1e6,
      totalGravityMicros: total.toString(),
      holders: all
        .sort((a, b) =>
          BigInt(a.gravityMicros) === BigInt(b.gravityMicros)
            ? a.wallet.localeCompare(b.wallet)
            : BigInt(a.gravityMicros) > BigInt(b.gravityMicros)
              ? -1
              : 1,
        )
        .map((h) => ({
          wallet: h.wallet,
          balance: Number(h.balanceRaw) / 10 ** token.tokenDecimals,
          balanceRaw: h.balanceRaw,
          gravityMicros: h.gravityMicros,
          gravity: Number(h.gravityMicros) / 1e6,
          probability:
            total > 0n
              ? Number((BigInt(h.gravityMicros) * 1_000_000_000n) / total) / 1e9
              : 0,
        })),
    };
  }
  applySnapshot(
    uid: string,
    snapshot: {
      holders: Holder[];
      slot: number;
      observedAt: number;
      complete: boolean;
    },
    priceUsd: number,
    now = Date.now(),
  ) {
    return this.repo.tx((tx) => {
      if (
        !snapshot.complete ||
        snapshot.observedAt > now + 5000 ||
        now - snapshot.observedAt > 120_000
      )
        throw new Error("Incomplete or stale snapshot");
      validateHolders(snapshot.holders);
      positive(priceUsd);
      safeInteger(snapshot.slot);
      safeInteger(now);
      const token = tx.tokens.get(uid);
      if (!token || token.status !== "live")
        throw new Error("Token is not live");
      const state = tx.operations.state(uid);
      if (
        snapshot.slot < token.holdersSnapshotSlot ||
        snapshot.observedAt < (state?.snapshotAt || 0)
      )
        return false;
      const observed = new Set(snapshot.holders.map((h) => h.wallet));
      for (const previous of tx.holders.byToken(uid))
        if (!observed.has(previous.wallet))
          tx.holders.syncBalance({
            tokenId: uid,
            wallet: previous.wallet,
            balanceRaw: "0",
            slot: snapshot.slot,
            observedAt: snapshot.observedAt,
          });
      for (const holder of snapshot.holders) {
        const raw =
          holder.balanceRaw ??
          humanToRaw(
            holder.balanceUi ?? holder.balance.toFixed(token.tokenDecimals),
            token.tokenDecimals,
          );
        tx.holders.syncBalance({
          tokenId: uid,
          wallet: holder.wallet,
          balanceRaw: raw,
          slot: snapshot.slot,
          observedAt: snapshot.observedAt,
        });
        tx.holders.exclude(uid, holder.wallet, Boolean(holder.excluded));
      }
      tx.tokens.setSnapshot(uid, snapshot.slot);
      if (state)
        tx.operations.updateState(uid, { snapshotAt: snapshot.observedAt });
      tx.tokens.setMarket(uid, { priceUsd, marketCapUsd: token.marketCapUsd });
      return tx.holders.accrueMinute(
        uid,
        Math.floor(now / 60_000),
        BigInt(Math.round(priceUsd * 1e12)),
      );
    });
  }
  publicToken(uid: string) {
    const t = this.token(uid);
    return {
      uid: t.uid,
      name: t.name,
      symbol: t.symbol,
      description: t.description,
      image: t.image,
      website: t.website,
      x: t.x,
      telegram: t.telegram,
      mint: t.mint,
      status: t.status,
      priceUsd: t.priceUsd,
      collectedMicros: t.collectedMicros,
      spentMicros: t.spentMicros,
      reservedMicros: t.reservedMicros,
      createdAt: t.createdAt,
      leaderboard: this.leaderboard(uid),
    };
  }
}
