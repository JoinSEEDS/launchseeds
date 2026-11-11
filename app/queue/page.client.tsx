/** The launch line, live: each coin's description and a countdown to its launch
 * time. This browser's own coins are picked out and followed, with a notification
 * when one deploys. Admin wallets get "Launch now" and "Remove", each signed. */
import bs58 from "bs58";
import { connectWallet, subscribeWallet, walletAddress } from "../../lib/wallet-session";
import { walletProvider } from "../../lib/wallet-provider";
import { getJson, postJson } from "../../lib/client-request";
import { queueDecisionMessage } from "../../lib/queue-message";
import { forgetLaunch, myLaunches, rememberLaunch } from "../../lib/my-launches";
import type { queueList, queueState } from "../../src/server/launch-queue";

type List = ReturnType<typeof queueList> & { admins?: string[] };
type State = NonNullable<ReturnType<typeof queueState>>;
type Child = Node | string | null | undefined | false;
function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) if (c) n.append(c);
  return n;
}
const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
/** "12:04" until a launch time; "launching" once it has come. */
function countdown(at: number, now = Date.now()) {
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  if (!s) return "Launching";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `Launches in ${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
}

export default function mount() {
  const root = document.getElementById("queue-root");
  const box = root?.querySelector<HTMLElement>("[data-queue-list]");
  if (!root || !box) return;
  let list: List = JSON.parse(root.dataset.queue ?? "{}"), wallet = walletAddress() ?? "", stopped = false, busy = false, scrolled = false;
  // The server's clock, so countdowns don't drift with a wrong local clock.
  let skew = list.now ? list.now - Date.now() : 0;
  const now = () => Date.now() + skew;
  const note = el("p", { class: "notice hidden", role: "status" });
  const banner = el("div", { class: "notice hidden", role: "status", "aria-live": "polite" });
  root.prepend(banner, note);
  const say = (text: string, error = false) => { note.textContent = text; note.classList.toggle("hidden", !text); note.classList.toggle("is-error", error); };

  // This browser's own launches: from the link it came with, and earlier ones.
  const fromLink = new URLSearchParams(location.search).get("mine");
  if (fromLink) rememberLaunch(fromLink);
  const mine = new Set(myLaunches());
  const states = new Map<string, State>();
  const symbolOf = (key: string) => [...list.waiting, ...list.recent].find((w) => w.key === key)?.symbol ?? "";

  function notify(key: string, state: State) {
    const symbol = symbolOf(key), url = state.status === "started" ? state.coinUrl : null;
    const text = state.status === "started" ? `$${symbol} is launching now.` : `$${symbol} did not launch.`;
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification("LaunchSeeds", { body: text, icon: "/logo.png" });
      if (url) n.onclick = () => { window.focus(); location.assign(url); };
    }
  }
  async function follow() {
    for (const key of mine) {
      const before = states.get(key);
      if (before && before.status !== "waiting") continue;
      try {
        const state = await getJson<State>(`/api/seeds?key=${key}`);
        if (before?.status === "waiting" && state.status !== "waiting") notify(key, state);
        states.set(key, state);
        if (state.status !== "waiting") forgetLaunch(key);
      } catch { mine.delete(key); forgetLaunch(key); }
    }
    paintBanner();
  }
  function paintBanner() {
    const lines: Node[] = [];
    for (const [key, s] of states) {
      const symbol = symbolOf(key) || "Your coin";
      if (s.status === "waiting") lines.push(el("div", {}, el("b", {}, `$${symbol}`), ` · #${s.position} in line · ${countdown(s.scheduledFor, now()).toLowerCase()}`));
      else if (s.status === "started") lines.push(el("div", {}, el("b", {}, `$${symbol}`), " is launching. ", s.coinUrl ? el("a", { href: s.coinUrl }, "Open its page →") : null));
      else lines.push(el("div", {}, el("b", {}, `$${symbol}`), ` did not launch: ${s.error}`));
    }
    banner.replaceChildren(...lines);
    banner.classList.toggle("hidden", !lines.length);
  }

  async function decide(key: string, decision: "approve" | "reject") {
    if (busy) return;
    busy = true;
    try {
      wallet = await connectWallet(window);
      const provider = walletProvider(window);
      if (!provider) throw new Error("Connect a supported Solana wallet.");
      const r = { wallet, key, decision, issuedAt: Date.now(), nonce: nonce() };
      say("Sign in your wallet…");
      const signature = bs58.encode((await provider.signMessage(new TextEncoder().encode(queueDecisionMessage(r)), "utf8")).signature);
      list = await postJson<List>("/api/queue", { ...r, signature });
      say(decision === "approve" ? "Launching now." : "Removed from the queue.");
      paint();
    } catch (error) {
      say(error instanceof Error ? error.message : "That didn't work.", true);
    } finally { busy = false; }
  }

  function paint() {
    const admin = !!wallet && (list.admins ?? []).includes(wallet);
    const rows: Node[] = list.waiting.map((w) => {
      const button = (label: string, cls: string, run: () => void) => { const b = el("button", { class: `btn ${cls}`, type: "button", style: "font-size:14px" }, label); b.addEventListener("click", run); return b; };
      const actions = admin ? el("div", { class: "actions" },
        w.launchingNow ? null : button("Launch now", "btn-primary", () => { if (confirm(`Launch $${w.symbol} now?`)) void decide(w.key, "approve"); }),
        button("Remove", "btn-white", () => { if (confirm(`Remove $${w.symbol} from the queue? It will not launch.`)) void decide(w.key, "reject"); })) : null;
      return el("article", { class: mine.has(w.key) ? "task mine" : "task" },
        el("div", { class: "who" },
          w.image ? el("img", { class: "avatar", src: w.image, alt: "", style: "object-fit:cover" }) : el("span", { class: "avatar", "aria-hidden": "true" }, w.symbol.slice(0, 2)),
          el("div", { style: "min-width:0" },
            el("div", { class: "line1" }, el("b", {}, `$${w.symbol}`), el("span", { class: "when" }, `#${w.position} · ${w.name}`)),
            w.description ? el("span", { class: "note" }, w.description) : null)),
        el("div", { class: "amounts" }, el("span", { class: "ask-big", "data-at": String(w.launchingNow ? 0 : w.scheduledFor) }, countdown(w.launchingNow ? 0 : w.scheduledFor, now()))),
        actions);
    });
    const recent: Node[] = list.recent.map((r) => el("article", { class: "task" },
      el("div", { class: "who" }, el("div", { style: "min-width:0" }, el("div", { class: "line1" }, el("b", {}, `$${r.symbol}`), el("span", { class: "when" }, ago(r.createdAt))), el("span", { class: "note" }, r.name))),
      el("div", { class: "amounts" }, r.status === "started" && r.coinUrl ? el("a", { class: "tx-link", href: r.coinUrl }, "Launched →") : el("span", { class: "status status-rejected" }, r.error ?? "Not launched"))));
    box!.replaceChildren(...(rows.length ? rows : [el("div", { class: "empty" }, "No coins waiting.")]),
      ...(recent.length ? [el("h2", { style: "margin:18px 0 6px;font-size:18px" }, "Last 24 hours"), ...recent] : []));
    if (!scrolled) { const own = box!.querySelector(".task.mine"); if (own) { own.scrollIntoView({ block: "center" }); scrolled = true; } }
  }
  const load = async () => {
    try {
      list = await getJson<List>("/api/queue");
      if (list.now) skew = list.now - Date.now();
      if (stopped) return;
      paint();
      await follow();
    } catch {}
  };
  // Countdowns tick every second; the line itself refreshes every 5 seconds.
  const tick = setInterval(() => {
    box.querySelectorAll<HTMLElement>("[data-at]").forEach((n) => { n.textContent = countdown(Number(n.dataset.at), now()); });
    paintBanner();
  }, 1_000);
  const unsubscribe = subscribeWallet((address) => { if (address !== wallet) { wallet = address; paint(); } });
  paint();
  void load();
  const timer = setInterval(() => { if (!document.hidden && !busy) void load(); }, 5_000);
  return () => { stopped = true; clearInterval(timer); clearInterval(tick); unsubscribe(); };
}
