/** Reused-wallet mode. When LAUNCHSEEDS_REUSE_WALLETS lists Solard wallet names,
 * launches draw their funding and bundle-buyer wallets from that pool instead
 * of creating fresh `launchseeds-<CA>` / `launchseeds-bundle-<CA>-N` wallets per token.
 * Wallets rotate deterministically by mint, so every stage of one launch
 * (planning, preparation, execution) picks the same addresses. Unset the
 * variable to return to fresh wallets per launch. Mint keypairs always stay
 * per-token: one mint key is one coin. */
export function reuseWalletPool(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.LAUNCHSEEDS_REUSE_WALLETS?.trim();
  if (!raw) return [];
  const pool = raw.split(",").map((name) => name.trim()).filter(Boolean);
  if (new Set(pool).size !== pool.length)
    throw new Error("LAUNCHSEEDS_REUSE_WALLETS contains duplicate wallet names");
  return pool;
}

/** Stable pool slot for a seed (a mint CA): the same seed always starts at
 * the same slot, so independent call sites agree on the rotation. */
function poolSlot(seed: string, pool: string[], offset: number): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  const start = ((hash % pool.length) + pool.length) % pool.length;
  return pool[(start + offset) % pool.length]!;
}

/** Picks `count` distinct pool wallets for a seed, scanning rotation slots
 * from `startOffset`. Skips wallets in `exclude` (e.g. a launch's buyers when
 * choosing its distinct funding wallet). */
export function poolWallets(
  seed: string,
  pool: string[],
  count: number,
  { exclude = [], startOffset = 0 }: { exclude?: ReadonlyArray<string>; startOffset?: number } = {},
): string[] {
  const skip = new Set(exclude);
  const picked: string[] = [];
  for (let i = startOffset; picked.length < count && i < startOffset + pool.length * 2; i++) {
    const wallet = poolSlot(seed, pool, i);
    if (!picked.includes(wallet) && !skip.has(wallet)) picked.push(wallet);
  }
  if (picked.length < count)
    throw new Error(
      `LAUNCHSEEDS_REUSE_WALLETS pool is too small: need ${count} distinct wallets${exclude.length ? " outside the excluded set" : ""}, have ${pool.length}`,
    );
  return picked;
}
