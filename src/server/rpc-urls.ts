/** The main RPC first, then `[solana] rpc_backup_urls` (comma separated):
 * Solard fails reads over to a backup while the main one is cooling down. */
export function rpcUrlList(
  rpcUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const backups = (env.SOLANA_RPC_BACKUP_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^https:\/\//.test(u) && u !== rpcUrl);
  return [rpcUrl, ...new Set(backups)];
}
