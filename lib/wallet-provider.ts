/** The browser wallet extension (Phantom, Solflare, Backpack), if one is installed. */
export interface WalletProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(
    bytes: Uint8Array,
    encoding?: string,
  ): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction?(
    transaction: import("@solana/web3.js").Transaction,
  ): Promise<unknown>;
  disconnect?(): Promise<void>;
}

export function walletProvider(windowLike: unknown): WalletProvider | null {
  if (!windowLike || typeof windowLike !== "object") return null;
  const holder = windowLike as {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
    backpack?: { solana?: WalletProvider };
    solana?: WalletProvider;
  };
  const candidates = [
    holder.phantom?.solana,
    holder.solflare,
    holder.backpack?.solana,
    holder.solana,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.connect !== "function") continue;
    if (typeof candidate.signMessage !== "function") continue;
    return candidate;
  }
  return null;
}

