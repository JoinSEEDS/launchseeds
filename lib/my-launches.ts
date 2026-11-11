/** This browser's own queued launches, so the queue page can pick them out and
 * notify when they deploy. Only public queue keys are kept. */
const KEY = "launchseeds:my-launches";
const valid = (k: unknown): k is string => typeof k === "string" && /^[a-f0-9]{32}$/.test(k);

export function myLaunches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(valid).slice(-20) : [];
  } catch {
    return [];
  }
}
export function rememberLaunch(key: string) {
  if (!valid(key)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...myLaunches().filter((k) => k !== key), key].slice(-20)));
  } catch {}
}
export function forgetLaunch(key: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(myLaunches().filter((k) => k !== key)));
  } catch {}
}
