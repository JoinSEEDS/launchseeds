/** A ticker: 1-13 letters, digits or the separators in names like d/acc. */
export const TICKER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9/._-]{0,11}[A-Za-z0-9])?$/;
/** All-lowercase plain tickers become uppercase. Any other ticker keeps the case it was typed in. */
export const normalizeTicker = (value: string) => /^[a-z0-9]+$/.test(value) ? value.toUpperCase() : value;
