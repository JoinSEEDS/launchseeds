/** The launch page's promotion line (`[launchseeds] promo`), e.g. "Free launches today".
 * Unset or empty: no promotion shown. */
export function launchPromo(env: Record<string, string | undefined> = process.env) {
  const text = env.LAUNCHSEEDS_PROMO?.trim() ?? "";
  return text ? text.slice(0, 80) : null;
}
