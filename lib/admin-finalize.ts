/** Coin page: the admin finalize panel. Visible to a connected admin wallet
 * (or with ?admin, to connect one); the server re-checks the wallet and the
 * signature, so showing it grants nothing. */
import bs58 from "bs58";
import { finalizeMessage } from "./bundle-message";
import { postJson } from "./client-request";
import { connectWallet, subscribeWallet, walletAddress } from "./wallet-session";
import { walletProvider } from "./vote-ui";

export function mountAdminFinalize(): () => void {
  const panel = document.getElementById("admin-finalize");
  if (!panel) return () => {};
  const admins = (panel.dataset.admins ?? "").split(",").filter(Boolean);
  const mint = panel.dataset.mint ?? "";
  const connect = document.getElementById("admin-connect") as HTMLButtonElement;
  const button = document.getElementById("admin-finalize-button") as HTMLButtonElement;
  const liquidate = document.getElementById("admin-liquidate-button") as HTMLButtonElement | null;
  const note = document.getElementById("admin-finalize-message")!;
  const asked = new URLSearchParams(location.search).has("admin");
  const say = (text: string, error = false) => {
    note.textContent = text;
    note.hidden = !text;
    note.classList.toggle("is-error", error);
  };
  // The wallet this panel last saw: the header's connect reaches it through the
  // launchseeds:wallet event, which another bundle's wallet-session copy may not.
  let current = "";
  const paint = (wallet: string) => {
    current = wallet;
    const admin = admins.includes(wallet);
    panel.hidden = !(admin || asked);
    connect.hidden = admin;
    button.hidden = !admin;
    if (liquidate) liquidate.hidden = !admin;
    if (asked && wallet && !admin) say("This wallet is not an admin wallet.", true);
  };
  paint(walletAddress());
  const unsubscribe = subscribeWallet(paint);

  connect.addEventListener("click", async () => {
    try { paint(await connectWallet(window)); } catch (error) { say(error instanceof Error ? error.message : "Could not connect.", true); }
  });
  const run = async (action: "finalize" | "liquidate", control: HTMLButtonElement) => {
    const wallet = current || walletAddress();
    const provider = walletProvider(window);
    if (!admins.includes(wallet)) return say("Connect an admin wallet first.", true);
    if (!provider) return say("No Solana wallet extension found to sign with.", true);
    // The extension must sign as the admin wallet, not another of its accounts.
    const signer = (provider as { publicKey?: { toString(): string } | null }).publicKey?.toString();
    if (signer !== wallet) {
      const connected = (await provider.connect()).publicKey?.toString();
      if (connected !== wallet) return say("Switch your wallet extension to the admin wallet, then try again.", true);
    }
    if (!confirm(action === "liquidate"
      ? "Liquidate everything? Every launch wallet sells all its tokens of this coin at market now, and the deployer is emptied to the proceeds wallet."
      : "Finalize this coin? Everything still holding sells at market now.")) return;
    control.disabled = true;
    try {
      say("Sign the finalize in your wallet. It is free and sends nothing.");
      const issuedAt = Date.now();
      const signed = await provider.signMessage(new TextEncoder().encode(finalizeMessage(mint, wallet, issuedAt, action)), "utf8");
      say("Finalizing…");
      const { results } = await postJson<{ results: string[] }>(
        `/api/tokens/${encodeURIComponent(mint)}/finalize`,
        { wallet, issuedAt, action, signature: bs58.encode(signed.signature) },
        { timeoutMs: 120_000 },
      );
      say(`${results.join(" · ")}. The worker sells and pays out within a minute or two; reload to follow it.`);
    } catch (error) {
      say(error instanceof Error ? error.message : "Finalize failed.", true);
    } finally {
      control.disabled = false;
    }
  };
  button.addEventListener("click", () => void run("finalize", button));
  liquidate?.addEventListener("click", () => void run("liquidate", liquidate));
  return unsubscribe;
}
