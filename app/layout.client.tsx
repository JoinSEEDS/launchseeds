import { copyText } from "../lib/client-request";
import {
  connectWallet,
  syncWalletProvider,
  subscribeWallet,
  walletAddress,
} from "../lib/wallet-session";
import { watchLiveNumbers } from "../lib/live-numbers";

/** Every popup closes on an outside click; Esc is built into <dialog>.
 * A press must start and end on the backdrop (outside the dialog box), so a
 * text selection dragged out of the dialog does not close it. */
function closeDialogsOnBackdrop(): () => void {
  let pressed: HTMLDialogElement | null = null;
  const outside = (dialog: HTMLDialogElement, event: MouseEvent) => {
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  };
  const down = (event: PointerEvent) => {
    const target = event.target;
    pressed =
      target instanceof HTMLDialogElement &&
      target.open &&
      outside(target, event)
        ? target
        : null;
  };
  const click = (event: MouseEvent) => {
    const target = event.target;
    if (pressed && target === pressed && outside(pressed, event))
      pressed.close("cancel");
    pressed = null;
  };
  document.addEventListener("pointerdown", down);
  document.addEventListener("click", click);
  return () => {
    document.removeEventListener("pointerdown", down);
    document.removeEventListener("click", click);
  };
}

/** Header reflects one shared wallet session; never creates a demo wallet. */
export default function mount() {
  const releaseDialogs = closeDialogsOnBackdrop();
  const stopNumbers = watchLiveNumbers();
  const button = document.querySelector<HTMLButtonElement>("[data-wallet-btn]");
  let busy = false;
  const repaint = (address = walletAddress()) => {
    if (!button || busy) return;
    button.textContent = address
      ? `${address.slice(0, 4)}…${address.slice(-4)}`
      : "Connect Wallet";
    button.classList.toggle("is-connected", Boolean(address));
  };
  const unsubscribe = subscribeWallet(repaint);
  syncWalletProvider(window);
  repaint();

  const connect = async () => {
    if (!button || busy) return;
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

  const copyLabels = new WeakMap<HTMLElement, string>();
  const copyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  const copies = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-copy]",
    );
    if (!target) return;
    void copyText(target.dataset.copy || "").then((ok) => {
      if (!ok) return;
      // Keep the original label across repeated clicks, then restore it.
      const label = copyLabels.get(target) ?? target.textContent ?? "";
      copyLabels.set(target, label);
      clearTimeout(copyTimers.get(target));
      target.textContent = "Copied";
      copyTimers.set(
        target,
        setTimeout(() => {
          target.textContent = label;
          copyLabels.delete(target);
        }, 1500),
      );
    });
  };
  button?.addEventListener("click", connect);
  document.addEventListener("click", copies);
  return () => {
    releaseDialogs();
    stopNumbers();
    button?.removeEventListener("click", connect);
    document.removeEventListener("click", copies);
    unsubscribe();
  };
}
