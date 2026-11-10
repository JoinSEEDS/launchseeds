import type { NewRows, Token } from "../src/db/schema";
import { schemas } from "../src/db/schema";
import type { Store } from "../src/server/store";
export const WALLET = "11111111111111111111111111111111";
const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
/** A token insert payload (no id); insert it with `store.repo.tokens.insert`. */
export function tokenFixture(
  patch: Partial<NewRows["tokens"]> = {},
): NewRows["tokens"] {
  return schemas.tokens.parse({
    handle: hex(16),
    mint: null,
    mintSignerRef: null,
    name: "Example",
    symbol: "EX",
    description: "Official description",
    image: "https://example.org/image.png",
    metadataUri: null,
    fundingWallet: WALLET,
    fundingWalletName: "fixture",
    creatorWallet: WALLET,
    rewardWallet: WALLET,
    launcherWallet: null,
    refundWallet: null,
    requiredLamports: "20000000",
    devBuyLamports: "0",
    quoteExpiresAt: Date.now() + 300000,
    status: "live",
    deploySignature: null,
    feeConfigSignature: null,
    error: null,
    createdAt: Date.now(),
    launchedAt: Date.now(),
    accessHash: hex(32),
    requestHash: hex(32),
    inputJson: "{}",
    ...patch,
  });
}
/** Inserts a fixture token and returns the stored row (with its id). */
export function insertToken(
  store: Store,
  patch: Partial<NewRows["tokens"]> = {},
): Token {
  const id = store.repo.tokens.insert(tokenFixture(patch));
  return store.repo.tokens.get(id)!;
}

/** Valid settings for a scheduled launch: one column of `slots` (lamports), sold at a $5k floor. */
export function scheduledSettings(scheduledAt: number, slots: number[] = [100_000_000], feesTo = "Vote111111111111111111111111111111111111111") {
  return {
    publishMint: true,
    publishProject: true,
    scheduledAt,
    userBatches: { proceedsWallet: "Stake11111111111111111111111111111111111111", columns: [{ slots, exit: { kind: "floor" as const, usd: 5000 } }] },
    bundleLamports: slots.reduce((a, b) => a + b, 0),
    feesTo,
  };
}
