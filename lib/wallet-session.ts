import { walletProvider, type WalletProvider } from "./wallet-provider";
import { WALLET_ADDRESS } from "./wallet-lookup";

/**
 * One browser wallet state for the header, launch, token, and Wallet route.
 * There is no demo address, implicit signing, storage of credentials, or
 * provider auto-connect request. Only explicit connections call connect().
 *
 * The tiny launchseeds:wallet event is retained for route controllers already
 * listening for a successful connection; it does not contain a secret.
 */
type WalletChange = { address: string };
type ProviderWithEvents = WalletProvider & {
  on?: (name: string, handler: (value?: unknown) => void) => void;
  off?: (name: string, handler: (value?: unknown) => void) => void;
  removeListener?: (name: string, handler: (value?: unknown) => void) => void;
};

let connectedAddress = "";
let trackedProvider: ProviderWithEvents | null = null;
let pendingConnection: Promise<string> | null = null;

export const walletAddress = () => connectedAddress;

function browserWindow(): Window | null {
  return typeof window !== "undefined" ? window : null;
}

function addressFrom(value: unknown): string {
  if (typeof value === "string") return WALLET_ADDRESS.test(value) ? value : "";
  if (!value || typeof value !== "object") return "";
  const account = value as {
    publicKey?: { toString(): string } | null;
    toString?: () => string;
  };
  if (account.publicKey) return addressFrom(account.publicKey.toString());
  // Wallet providers emit a PublicKey directly on accountChanged.
  const string = account.toString?.();
  return string && WALLET_ADDRESS.test(string) ? string : "";
}

export function publishWallet(address: string): string {
  if (!WALLET_ADDRESS.test(address))
    throw new Error("Invalid Solana wallet address.");
  if (connectedAddress === address) return address;
  connectedAddress = address;
  browserWindow()?.dispatchEvent(
    new CustomEvent<WalletChange>("launchseeds:wallet", {
      detail: { address },
    }),
  );
  return address;
}

export function publishWalletDisconnected() {
  if (!connectedAddress) return;
  connectedAddress = "";
  browserWindow()?.dispatchEvent(
    new CustomEvent("launchseeds:wallet-disconnected"),
  );
}

const onAccountChanged = (value?: unknown) => {
  const next = addressFrom(value);
  if (next) publishWallet(next);
  else publishWalletDisconnected();
};

const onProviderDisconnected = () => publishWalletDisconnected();

/** Register wallet-native accountChanged/disconnect events once per provider. */
export function trackWalletProvider(provider: WalletProvider): void {
  const candidate = provider as ProviderWithEvents;
  if (trackedProvider === candidate) return;
  const old = trackedProvider;
  old?.off?.("accountChanged", onAccountChanged);
  old?.off?.("disconnect", onProviderDisconnected);
  if (!old?.off) {
    old?.removeListener?.("accountChanged", onAccountChanged);
    old?.removeListener?.("disconnect", onProviderDisconnected);
  }
  trackedProvider = candidate;
  candidate.on?.("accountChanged", onAccountChanged);
  candidate.on?.("disconnect", onProviderDisconnected);
}

/**
 * Observing an already authorized provider publicKey is not an implicit
 * connect prompt. It only reflects the wallet's current connected state.
 */
export function syncWalletProvider(windowLike: unknown): string {
  const provider = walletProvider(windowLike);
  if (!provider) return connectedAddress;
  trackWalletProvider(provider);
  const address = addressFrom(provider.publicKey?.toString());
  if (address) publishWallet(address);
  return connectedAddress;
}

/** Concurrent callers share the same wallet permission prompt. */
export function connectWallet(
  windowLike: unknown = browserWindow(),
): Promise<string> {
  if (pendingConnection) return pendingConnection;
  const provider = walletProvider(windowLike);
  if (!provider)
    return Promise.reject(new Error("Connect a supported Solana wallet."));
  trackWalletProvider(provider);
  const task = (async () => {
    const response = await provider.connect();
    const address = addressFrom(response?.publicKey?.toString());
    if (!address) throw new Error("Wallet returned an invalid Solana address.");
    return publishWallet(address);
  })();
  pendingConnection = task;
  void task
    .finally(() => {
      if (pendingConnection === task) pendingConnection = null;
    })
    .catch(() => {});
  return task;
}

/** Explicit disconnect updates every subscribed control even on provider error. */
export async function disconnectWallet(): Promise<void> {
  const provider = trackedProvider;
  try {
    await provider?.disconnect?.();
  } finally {
    publishWalletDisconnected();
  }
}

/** Listener is symmetrical and does not interfere with route teardown. */
export function subscribeWallet(
  listener: (address: string) => void,
): () => void {
  const current = browserWindow();
  if (!current) return () => {};
  const changed = (event: Event) => {
    const next = (event as CustomEvent<WalletChange>).detail?.address ?? "";
    if (WALLET_ADDRESS.test(next)) listener(next);
  };
  const disconnected = () => listener("");
  current.addEventListener("launchseeds:wallet", changed);
  current.addEventListener("launchseeds:wallet-disconnected", disconnected);
  return () => {
    current.removeEventListener("launchseeds:wallet", changed);
    current.removeEventListener("launchseeds:wallet-disconnected", disconnected);
  };
}
