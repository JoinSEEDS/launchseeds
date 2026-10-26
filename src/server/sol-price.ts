/** Last SOL/USD price this process fetched, for synchronous USD views of SOL
 * treasuries. Written by `solUsd()` in ./solard; null until then or when stale. */
let last: { value: number; at: number } | null = null;

export function rememberSolUsd(value: number, at = Date.now()) {
  if (Number.isFinite(value) && value > 0) last = { value, at };
}

export function lastKnownSolUsd(maxAgeMs = 15 * 60_000, now = Date.now()): number | null {
  return last && now - last.at <= maxAgeMs ? last.value : null;
}
