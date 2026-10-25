/** Optional social fields accept pasted profile links as well as handles. */
export function normalizeX(value: string): string {
  return value.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})\/?(?:\?[^\s]*)?$/i, "$1");
}

export function validTelegram(value: string): boolean {
  const text = value.trim();
  return !text || /^@?[A-Za-z0-9_]{5,32}$/.test(text) ||
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:[A-Za-z0-9_]{5,32}|\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)\/?(?:\?[^\s]*)?$/i.test(text);
}
