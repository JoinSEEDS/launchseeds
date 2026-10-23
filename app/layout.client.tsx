import { copyText } from "../lib/client-request";
import {
  connectWallet,
  syncWalletProvider,
  subscribeWallet,
  walletAddress,
} from "../lib/wallet-session";

/** Header reflects one shared wallet session; never creates a demo wallet. */
export default function mount() {
  const button = document.querySelector<HTMLButtonElement>("[data-wallet-btn]");
  if (!button) return;

  let busy = false;
  const repaint = (address = walletAddress()) => {
    if (busy) return;
    button.textContent = address
      ? `${address.slice(0, 4)}…${address.slice(-4)}`
      : "Connect Wallet";
    button.classList.toggle("is-connected", Boolean(address));
  };
  const unsubscribe = subscribeWallet(repaint);
  syncWalletProvider(window);
  repaint();

  const connect = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = "Connecting…";
    try {
      await connectWallet(window);
      repaint();
    } catch (error) {
      // This is a user-facing wallet error, not an internal data-feed status.
      button.textContent =
        error instanceof Error ? error.message : "Connection cancelled";
    } finally {
      busy = false;
      button.disabled = false;
      // After a failure leave the message briefly? No timer or fake state:
      // the next wallet action will replace it, and successful connects
      // repaint the connected address immediately.
      if (walletAddress()) repaint();
    }
  };

  const pathname = window.location.pathname;
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    ".topbar .nav a",
  )) {
    const target = new URL(anchor.href).pathname;
    const active =
      target === "/"
        ? pathname === "/"
        : pathname === target || pathname.startsWith(`${target}/`);
    if (active) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  }

  const copies = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-copy]",
    );
    if (!target) return;
    void copyText(target.dataset.copy || "").then((ok) => {
      if (ok) target.textContent = "Copied";
    });
  };
  button.addEventListener("click", connect);
  document.addEventListener("click", copies);
  return () => {
    button.removeEventListener("click", connect);
    document.removeEventListener("click", copies);
    unsubscribe();
  };
}
