/** Wallets that may finalize any coin (`[launchseeds] admin_wallets`, comma-separated).
 * Public addresses: the coin page uses them to show the admin panel. */
export function adminWallets(env: Record<string, string | undefined> = process.env): string[] {
  return (env.LAUNCHSEEDS_ADMIN_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter((w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w));
}
