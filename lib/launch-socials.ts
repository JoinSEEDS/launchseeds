/** Optional social fields accept handles and public X links copied from a coin. */
export function normalizeX(value: string): string {
  const text = value.trim();
  if (!text || /^@?[A-Za-z0-9_]{1,15}$/.test(text)) return text;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
        !/^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(url.hostname)) return text;
    const path = url.pathname.replace(/\/+$/, "");
    const profile = /^\/@?([A-Za-z0-9_]{1,15})$/.exec(path);
    if (profile) return profile[1]!;
    // Communities and posts are valid coin social links, not account handles.
    return `https://x.com${path}`;
  } catch { return text; }
}

export function validX(value: string): boolean {
  const normalized = normalizeX(value);
  return !normalized || /^@?[A-Za-z0-9_]{1,15}$/.test(normalized) ||
    /^https:\/\/x\.com\/(?:i\/communities\/\d+|i\/status\/\d+|[A-Za-z0-9_]{1,15}\/status\/\d+)$/.test(normalized);
}

/** Public link for both normalized handles and complete X URLs. */
export function xLink(value: string): string {
  const normalized = normalizeX(value);
  if (!normalized || !validX(normalized)) return "";
  return normalized.startsWith("https://") ? normalized : `https://x.com/${normalized.replace(/^@/, "")}`;
}

export function validTelegram(value: string): boolean {
  const text = value.trim();
  return !text || /^@?[A-Za-z0-9_]{5,32}$/.test(text) ||
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:[A-Za-z0-9_]{5,32}|\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)\/?(?:\?[^\s]*)?$/i.test(text);
}
