/** Only the public address is derived from the persisted signer name. Never create a mint for a preview. */
export function reservedMint(token: { mint?: string | null; mintSignerRef?: string | null }) {
  const mint = token.mint || (token.mintSignerRef?.startsWith("launchseeds-mint-") ? token.mintSignerRef.slice("launchseeds-mint-".length) : "");
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? mint : null;
}
