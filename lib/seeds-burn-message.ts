/** What an admin signs to spend the $SEEDS pool on a buyback and burn. */
export type SeedsBurnRequest = { wallet: string; mint: string; lamports: string; issuedAt: number; nonce: string };
export const seedsBurnMessage = (r: SeedsBurnRequest) =>
  `LaunchSeeds buy back and burn $SEEDS
Coin: ${r.mint}
Wallet: ${r.wallet}
Spend: ${r.lamports} lamports
Nonce: ${r.nonce}
Issued: ${new Date(r.issuedAt).toISOString()}`;
