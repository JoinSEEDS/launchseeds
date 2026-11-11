/** The $SEEDS page's live parts: burn history, numbers, and the admin's
 * "buy back & burn" form, signed in the admin's wallet. */
import bs58 from "bs58";
import { connectWallet, subscribeWallet, walletAddress } from "../../lib/wallet-session";
import { walletProvider } from "../../lib/wallet-provider";
import { getJson, postJson } from "../../lib/client-request";
import { seedsBurnMessage } from "../../lib/seeds-burn-message";
import type { SeedsView } from "../../src/server/seeds-view";

type View = SeedsView & { treasury?: string | null };
const sol = (l: string | number | bigint) => (Number(l) / 1e9).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const tokens = (raw: string) => (Number(raw) / 1e6).toLocaleString("en", { maximumFractionDigits: 0 });
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const STATUS: Record<string, string> = { queued: "Queued", buying: "Buying", bought: "Bought", burning: "Burning", done: "Burned", review: "Needs review" };
type Child = Node | string | null | undefined | false;
function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) if (c) n.append(c);
  return n;
}
const tx = (sig: string, label: string) => el("a", { class: "tx-link", href: `https://solscan.io/tx/${sig}`, target: "_blank", rel: "noopener noreferrer" }, label);

export default function mount() {
  const root = document.getElementById("seeds-root");
  if (!root) return;
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-seeds="${name}"]`);
  let view: View | null = null, wallet = walletAddress() ?? "", stopped = false, form: HTMLElement | null = null;
  const note = el("p", { class: "notice hidden", role: "status" });
  const say = (text: string, error = false) => { note.textContent = text; note.classList.toggle("hidden", !text); note.classList.toggle("is-error", error); };

  function adminForm(v: View) {
    const amount = el("input", { type: "number", min: "0.01", step: "0.01", inputmode: "decimal", value: (Math.floor(Number(v.pool.spendable) / 1e7) / 100).toFixed(2) }) as HTMLInputElement;
    amount.id = "burn-amount";
    const go = el("button", { class: "btn btn-primary btn-block", type: "button" }, "Buy back & burn") as HTMLButtonElement;
    go.addEventListener("click", async () => {
      try {
        wallet = await connectWallet(window);
        const provider = walletProvider(window);
        if (!provider || !v.mint) throw new Error("Connect a supported Solana wallet.");
        const lamports = String(Math.round(Number(amount.value) * 1e9));
        if (!confirm(`Spend ${sol(lamports)} SOL from the treasury buying $SEEDS, then burn it?`)) return;
        const r = { wallet, mint: v.mint, lamports, issuedAt: Date.now(), nonce: nonce() };
        say("Sign in your wallet…");
        const signature = bs58.encode((await provider.signMessage(new TextEncoder().encode(seedsBurnMessage(r)), "utf8")).signature);
        view = await postJson<View>("/api/seeds-burn", { ...r, signature });
        say("Queued. The buy and burn run within a minute or two.");
        form = null;
        paint();
      } catch (error) {
        say(error instanceof Error ? error.message : "That didn't work.", true);
      }
    });
    return el("section", { class: "card side-card" }, el("h2", {}, "Buy back & burn"),
      el("p", { class: "hint" }, `${sol(v.pool.spendable)} SOL is ready. The treasury buys $SEEDS with it and burns what it bought.`),
      el("div", { class: "field" }, el("label", { for: "burn-amount" }, "Spend (SOL)"), amount), go);
  }

  function paint() {
    const v = view;
    if (!v) return;
    const set = (name: string, text: string) => { const n = part(name); if (n) n.textContent = text; };
    set("accrued", sol(v.pool.accrued)); set("spendable", sol(v.pool.spendable)); set("spent", sol(v.pool.spent)); set("burned", tokens(v.pool.burnedRaw));
    const tw = document.querySelector("[data-treasury-wallet]");
    if (tw && v.treasury) tw.replaceChildren(el("a", { href: `https://solscan.io/account/${v.treasury}`, target: "_blank", rel: "noopener noreferrer" }, short(v.treasury)));
    const list = part("burns");
    if (list) list.replaceChildren(...(v.burns.length ? v.burns.map((b) => el("article", { class: "task" },
      el("div", { class: "who" }, el("div", { style: "min-width:0" },
        el("div", { class: "line1" }, el("span", { class: "when" }, new Date(b.doneAt ?? b.createdAt).toISOString().slice(0, 16).replace("T", " ") + " UTC")),
        el("span", { class: "note" }, b.status === "done" ? `Burned ${tokens(b.boughtRaw ?? "0")} $SEEDS` : STATUS[b.status] ?? b.status),
        b.error ? el("span", { class: "hint" }, b.error) : null)),
      el("div", { class: "amounts" }, el("span", { class: "paid" }, "Spent ", el("b", {}, `${sol(b.spentLamports ?? b.lamports)} SOL`))),
      el("div", { class: "actions" }, b.buySignature ? tx(b.buySignature, "buy ↗") : null, b.burnSignature ? tx(b.burnSignature, "burn ↗") : null),
    )) : [el("div", { class: "empty" }, "No burns yet.")]));
    const admin = part("admin");
    if (admin) {
      const isAdmin = !!wallet && v.admins.includes(wallet);
      const busy = v.burns.some((b) => !["done"].includes(b.status));
      if (isAdmin && v.mint && !busy && BigInt(v.pool.spendable) >= 10_000_000n) form ??= adminForm(v);
      else form = null;
      admin.replaceChildren(note, ...(form ? [form] : []));
    }
  }
  const load = async () => { try { view = await getJson<View>("/api/seeds-burn"); if (!stopped) paint(); } catch {} };
  const unsubscribe = subscribeWallet((address) => { if (address !== wallet) { wallet = address; paint(); } });
  void load();
  const timer = setInterval(() => { if (!document.hidden && !(document.activeElement?.id === "burn-amount")) void load(); }, 15_000);
  return () => { stopped = true; clearInterval(timer); unsubscribe(); };
}
