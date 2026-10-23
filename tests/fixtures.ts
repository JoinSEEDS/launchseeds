import type { Token } from "../src/db/schema";
import { schemas } from "../src/db/schema";
import type { Store } from "../src/server/store";
export const WALLET = "11111111111111111111111111111111";
export function tokenFixture(patch: Partial<Token> = {}): Token {
  return schemas.tokens.parse({
    uid: crypto.randomUUID(),
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
    ...patch,
  });
}
export function seedHolder(
  store: Store,
  tokenId: string,
  wallet = WALLET,
  balanceRaw = "25000000",
  gravityMicros = "100000000",
) {
  store.data.database.holders.insert({
    uid: crypto.randomUUID(),
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
