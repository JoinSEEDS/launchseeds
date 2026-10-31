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
    devBuyRecipient: null,
    refundWallet: null,
    requiredLamports: "20000000",
    devBuyLamports: "0",
    quoteExpiresAt: Date.now() + 300000,
    status: "live",
    deploySignature: null,
    feeConfigSignature: null,
    error: null,
    activeStrategyId: null,
    leaderStrategyId: null,
    leaderSince: null,
    lastGravityMinute: null,
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
export function seedHolder(
  store: Store,
  tokenId: number,
  wallet = WALLET,
  balanceRaw = "25000000",
  gravityMicros = "100000000",
) {
  store.data.database.holders.insert({
    tokenId,
    wallet,
    balanceRaw,
    gravityMicros,
    heldSince: Date.now(),
    balanceSlot: 1,
    balanceUpdatedAt: Date.now(),
    excluded: false,
  });
}
