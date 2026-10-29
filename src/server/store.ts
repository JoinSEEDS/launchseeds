import { isTokenToken } from "./token-holders";
import { lastKnownSolUsd } from "./sol-price";
import { createLaunchseedsCoreServices } from "../services";
import { humanToRaw } from "../domain/holders";
import { ed25519VoteVerifier } from "../integrations/ed25519";
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
export { humanToRaw } from "../domain/holders";
export class Store {
  readonly repo;
  constructor(readonly data: ReturnType<typeof openLaunchseedsData>) {
    this.repo = data.repo;
  }
  close() {
    this.data.database.close();
  }
  view(token: Token) {
    const state = this.repo.operations.state(token.id);
    const treasury = this.repo.treasuries.getByOwner(token.id, "USDC");
    // Existing UI labels USD evidence. Never present SOL atomic balances as USDC.
    const usdc = treasury
      ? this.repo.ledger.totals(treasury.id)
      : { collected: 0n, spent: 0n };
    // Claimed creator fees sit in the SOL treasury; shown in USD at the last
    // known SOL price (none known yet: not counted rather than guessed).
    const solTreasury = this.repo.treasuries.getByOwner(token.id, "SOL");
    const price = solTreasury ? lastKnownSolUsd() : null;
    const solTotals = solTreasury && price ? this.repo.ledger.totals(solTreasury.id) : { collected: 0n, spent: 0n };
    const lamportsToMicros = (lamports: bigint) => (lamports * BigInt(Math.round(price! * 1e6))) / 1_000_000_000n;
    const totals = price
      ? { collected: usdc.collected + lamportsToMicros(solTotals.collected), spent: usdc.spent + lamportsToMicros(solTotals.spent) }
      : usdc;
    const reserved =
      (treasury ? safeNumber(treasury.reservedAtomic) : 0) +
      (solTreasury && price ? safeNumber(lamportsToMicros(BigInt(solTreasury.reservedAtomic))) : 0);
    return {
      ...token,
      mint: token.mint || "",
      fundingWallet: token.fundingWallet,
      // Set once preparation completes; empty only while `preparing`.
      rewardWallet: token.rewardWallet ?? "",
      creatorWallet: token.creatorWallet ?? "",
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
  /** Internal id of a live token from its public CA; unknown or not live → Not found. */
  liveTokenId(mint: string): number {
    const token = this.repo.tokens.getByMint(mint);
    if (!token || token.status !== "live") throw new Error("Not found");
    return token.id;
  }
  token(id: number) {
    const token = this.repo.tokens.get(id);
    if (!token) throw new Error("Not found");
    return this.view(token);
  }
  /** LaunchSeeds's launches ($TOKEN itself is tracked, not listed). */
  listLive() {
    return this.repo.tokens
      .all()
      .filter((x) => x.status === "live" && !isTokenToken(x))
      .map((x) => this.view(x));
  }
  listWork() {
    return this.repo.tokens.all().map((x) => this.view(x));
  }
  leaderboard(id: number) {
    const token = this.repo.tokens.get(id);
    if (!token) throw new Error("Not found");
    const all = this.repo.holders.active(id);
    const total = this.repo.holders.totalGravity(id);
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
          heldSince: h.heldSince,
          gravityMicros: h.gravityMicros,
          gravity: Number(h.gravityMicros) / 1e6,
          probability:
            total > 0n
              ? Number((BigInt(h.gravityMicros) * 1_000_000_000n) / total) / 1e9
              : 0,
        })),
    };
  }
  /** Compatibility adapter for injected observations; domain behavior belongs to src/services. */
  async applySnapshot(
    id: number,
    snapshot: {
      holders: Holder[];
      slot: number;
      observedAt: number;
      complete: boolean;
    },
    priceUsd: number,
    now = Date.now(),
  ) {
    validateHolders(snapshot.holders);
    positive(priceUsd);
    const token = this.repo.tokens.get(id);
    if (!token) throw new Error("Not found");
    const source = {
      async snapshot() {
        return {
          complete: snapshot.complete,
          slot: snapshot.slot,
          observedAt: snapshot.observedAt,
          balances: snapshot.holders.map((h) => ({
            wallet: h.wallet,
            balanceRaw:
              h.balanceRaw ??
              humanToRaw(
                h.balanceUi ?? h.balance.toFixed(token.tokenDecimals),
                token.tokenDecimals,
              ),
            excluded: Boolean(h.excluded),
          })),
        };
      },
      async balance() {
        throw new Error("No individual balance supplied");
      },
    };
    const services = createLaunchseedsCoreServices({
      repo: this.repo,
      holders: source,
      market: {
        async priceUsd() {
          return priceUsd.toFixed(12).replace(/\.?0+$/, "") || "0";
        },
      },
      voteVerifier: ed25519VoteVerifier,
      chain: "test:injected",
      clock: () => now,
      requireFreshSnapshot: true,
    });
    await services.holders.syncSnapshot(id);
    return services.gravity.accrueMinute(id);
  }
  publicToken(id: number) {
    const t = this.token(id);
    return {
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
      leaderboard: this.leaderboard(id),
    };
  }
}
