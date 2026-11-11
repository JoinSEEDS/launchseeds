import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

/** Everything a creator launches with. The signature covers all of it. */
export type SeedRequest = {
  wallet: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  website: string;
  x: string;
  telegram: string;
  issuedAt: number;
  nonce: string;
};

/** Hash of the fields too long to show in a wallet prompt. */
export const seedDetailsHash = (r: Pick<SeedRequest, "description" | "image" | "website" | "x" | "telegram">) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([r.description, r.image, r.website, r.x, r.telegram]))));

/** The exact text a creator signs to launch a coin. Signing is free and sends nothing. */
export function seedMessage(r: SeedRequest) {
  return `LaunchSeeds launch
Coin: $${r.symbol} ${r.name}
Creator: ${r.wallet}
Details: ${seedDetailsHash(r)}
Nonce: ${r.nonce}
Issued: ${new Date(r.issuedAt).toISOString()}`;
}
