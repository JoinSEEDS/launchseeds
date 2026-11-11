/** The $SEEDS page's numbers and the admin's buyback request. Amounts are lamport strings. */
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/api-security";
import { seedsBurnMessage, type SeedsBurnRequest } from "../../lib/seeds-burn-message";
import { seedsMint } from "../domain/seeds-split";
import type { LaunchseedsRepo } from "../db/repo";
import type { Store } from "./store";
import { adminWallets } from "./admin-wallets";

export const MIN_BURN_LAMPORTS = 10_000_000n; // 0.01 SOL

export function seedsView(store: Store) {
  const mint = seedsMint(), c = store.repo.challenges, pool = c.seedsPool();
  const token = mint ? store.repo.tokens.getByMint(mint) : null;
  const burns = c.seedsBurns();
  const done = burns.filter((b) => b.status === "done");
  return {
    mint,
    coin: token ? { symbol: token.symbol, name: token.name, image: token.image, status: token.status, marketCapUsd: token.marketCapUsd || null } : null,
    admins: adminWallets(),
    pool: {
      bps: pool.bps, accrued: String(pool.accrued), spent: String(pool.spent), held: String(pool.held), spendable: String(pool.spendable),
      burnedRaw: String(done.reduce((n, b) => n + BigInt(b.boughtRaw ?? "0"), 0n)),
    },
    contributions: pool.contributions.slice(0, 50).map((x) => {
      const t = store.repo.tokens.get(x.tokenId);
      return { symbol: t?.symbol ?? "?", mint: t?.mint ?? null, feesLamports: String(x.feesLamports), seedsLamports: String(x.seedsLamports) };
    }),
    burns: burns.slice(0, 50).map((b) => ({
      id: b.id, status: b.status, lamports: b.lamports, spentLamports: b.spentLamports, boughtRaw: b.boughtRaw,
      buySignature: b.buySignature, burnSignature: b.status === "done" ? b.burnSignature : null, error: b.status === "review" ? b.error : null,
      createdAt: b.createdAt, doneAt: b.doneAt,
    })),
  };
}
export type SeedsView = ReturnType<typeof seedsView>;

type Verify = (input: { wallet: string; signature: string; message: string }) => Promise<boolean>;
/** An admin authorizes spending part of the $SEEDS pool; the worker runs it. */
export async function requestSeedsBurn(repo: Pick<LaunchseedsRepo, "challenges" | "tokens">, verify: Verify, admins: string[], r: SeedsBurnRequest, signature: string, now = Date.now()) {
  const mint = seedsMint();
  if (!mint || repo.tokens.getByMint(mint)?.status !== "live") throw new ApiError("$SEEDS is not launched yet.", 409);
  if (!admins.includes(r.wallet)) throw new ApiError("Only an admin wallet can do that.", 403);
  if (r.mint !== mint) throw new ApiError("Signed for another coin.", 400);
  if (!/^[a-f0-9]{32}$/.test(r.nonce) || !Number.isSafeInteger(r.issuedAt) || Math.abs(now - r.issuedAt) > 5 * 60_000) throw new ApiError("Sign a fresh request.", 400);
  if (!/^\d{1,19}$/.test(r.lamports) || BigInt(r.lamports) < MIN_BURN_LAMPORTS) throw new ApiError("Spend at least 0.01 SOL.", 400);
  if (!(await verify({ wallet: r.wallet, signature, message: seedsBurnMessage(r) }))) throw new ApiError("Signature does not match.", 403);
  const requestKey = createHash("sha256").update(signature).digest("hex");
  const { burn, error } = repo.challenges.queueSeedsBurn({ requestKey, authorizedBy: r.wallet, mint, lamports: BigInt(r.lamports), now });
  if (!burn) throw new ApiError(error ?? "Not queued.", 409);
  return burn;
}
