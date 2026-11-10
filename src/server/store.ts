/** Presentation facade. All authoritative reads and writes use src/db repositories. */
import type { openLaunchseedsData } from "../db";
import type { Token } from "../db/schema";
export const safeNumber = (value: string | bigint) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Amount exceeds numeric API range");
  return n;
};
export class Store {
  readonly repo;
  constructor(readonly data: ReturnType<typeof openLaunchseedsData>) {
    this.repo = data.repo;
  }
  close() {
    this.data.database.close();
  }
  view(token: Token) {
    return {
      ...token,
      mint: token.mint || "",
      fundingWallet: token.fundingWallet,
      rewardWallet: token.rewardWallet ?? "",
      creatorWallet: token.creatorWallet ?? "",
      requiredLamports: safeNumber(token.requiredLamports),
      devBuyLamports: safeNumber(token.devBuyLamports),
      receivedLamports: safeNumber(token.fundingReceivedLamports),
      launchSignature: token.deploySignature || "",
    };
  }
  /** Internal id of a live coin from its public CA; unknown or not live → Not found. */
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
  listLive() {
    return this.repo.tokens.all().filter((x) => x.status === "live").map((x) => this.view(x));
  }
  listWork() {
    return this.repo.tokens.all().map((x) => this.view(x));
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
      marketCapUsd: t.marketCapUsd,
      createdAt: t.createdAt,
    };
  }
}
