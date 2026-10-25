/**
 * Live numbers: any element marked `data-num` animates when its text changes.
 * It counts from the old value to the new one (keeping "$", "%", grouping and
 * decimals) and briefly flashes ▲ green or ▼ red to show the direction.
 * Works for plain textContent writes and for tradjs re-renders alike.
 */
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;
const DURATION_MS = 700;

type Parsed = { value: number; scaled: number; prefix: string; suffix: string; decimals: number; grouped: boolean };
const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

export function parseNumber(text: string): Parsed | null {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const suffix = text.slice(match.index + raw.length);
  return {
    value,
    scaled: value * (SCALE[suffix.trim()[0]?.toUpperCase() ?? ""] ?? 1),
    prefix: text.slice(0, match.index),
    suffix,
    decimals: raw.includes(".") ? raw.split(".")[1]!.length : 0,
    grouped: raw.includes(","),
  };
}

export function formatLike(target: Parsed, value: number): string {
  const body = value.toLocaleString("en-US", {
    minimumFractionDigits: target.decimals,
    maximumFractionDigits: target.decimals,
    useGrouping: target.grouped,
  });
  return target.prefix + body + target.suffix;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Starts watching the document; returns a stop function. */
export function watchLiveNumbers(root: ParentNode = document): () => void {
  if (typeof MutationObserver !== "function") return () => {};
  // The first fill after page load (server placeholder → real value) is not a
  // live change, so it is remembered without animating.
  const quietUntil = Date.now() + 2_500;
  const last = new WeakMap<Element, string>();
  // Text this module wrote itself. Observer callbacks run after the write, so
  // a flag cleared synchronously cannot recognise them; compare text instead.
  const own = new WeakMap<Element, string>();
  const frames = new WeakMap<Element, number>();
  const flashes = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const active = new Set<HTMLElement>();
  const remember = (scope: ParentNode) => {
    if (scope instanceof Element && scope.matches("[data-num]")) last.set(scope, scope.textContent ?? "");
    scope.querySelectorAll?.("[data-num]").forEach((el) => last.set(el, el.textContent ?? ""));
  };

  const flash = (el: HTMLElement, up: boolean) => {
    active.add(el);
    el.classList.remove("num-up", "num-down");
    void el.offsetWidth; // restart the flash animation
    el.classList.add(up ? "num-up" : "num-down");
    clearTimeout(flashes.get(el));
    flashes.set(el, setTimeout(() => {
      el.classList.remove("num-up", "num-down");
      active.delete(el);
    }, 1600));
  };

  const animate = (el: HTMLElement, from: Parsed, to: Parsed, finalText: string) => {
    flash(el, to.scaled > from.scaled);
    cancelAnimationFrame(frames.get(el) ?? 0);
    // Count only in a lone text node (written in place, so renderers keep
    // their node references) and only when the units match.
    const node = el.childNodes.length === 1 && el.firstChild instanceof Text ? el.firstChild : null;
    if (!node || reducedMotion() || from.prefix !== to.prefix || from.suffix !== to.suffix) return;
    let start: number | null = null;
    const step = (now: number) => {
      if (node.parentNode !== el || last.get(el) !== finalText) return; // replaced meanwhile
      start ??= now;
      const t = Math.min(1, (now - start) / DURATION_MS);
      const text = t < 1 ? formatLike(to, from.value + (to.value - from.value) * (1 - (1 - t) ** 3)) : finalText;
      own.set(el, text);
      node.nodeValue = text;
      if (t < 1) frames.set(el, requestAnimationFrame(step));
    };
    frames.set(el, requestAnimationFrame(step));
  };

  const check = (el: HTMLElement) => {
    const next = el.textContent ?? "";
    if (own.get(el) === next) return;
    own.delete(el);
    const previous = last.get(el);
    last.set(el, next);
    if (previous === undefined || previous === next || Date.now() < quietUntil) return;
    const from = parseNumber(previous), to = parseNumber(next);
    if (!from || !to || from.scaled === to.scaled) return;
    animate(el, from, to, next);
  };

  remember(root);
  const observer = new MutationObserver((mutations) => {
    const touched = new Set<HTMLElement>();
    for (const m of mutations) {
      const node = m.target instanceof Element ? m.target : m.target.parentElement;
      const el = node?.closest<HTMLElement>("[data-num]");
      if (el) touched.add(el);
      // Newly rendered subtrees: remember their numbers without animating.
      m.addedNodes.forEach((added) => {
        if (added instanceof Element) remember(added);
      });
    }
    touched.forEach(check);
  });
  observer.observe(root instanceof Document ? root.body : (root as Node), {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return () => {
    observer.disconnect();
    for (const el of active) {
      cancelAnimationFrame(frames.get(el) ?? 0);
      clearTimeout(flashes.get(el));
      el.classList.remove("num-up", "num-down");
    }
    active.clear();
  };
}
