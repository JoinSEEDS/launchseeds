/** Launch-page only: kept out of lib/wallet-session.ts so @solana/web3.js is
 * not bundled into every page that shows the wallet button. */
import { Transaction } from "@solana/web3.js";
import { walletProvider } from "./wallet-provider";

const browserWindow = (): Window | null =>
  typeof window !== "undefined" ? window : null;

/** Signs and sends a server-built, unsigned transaction (base64) with the
 * connected wallet. Returns the transaction signature. */
export async function sendWalletTransaction(
  serializedBase64: string,
  windowLike: unknown = browserWindow(),
): Promise<string> {
  const provider = walletProvider(windowLike);
  if (!provider?.signAndSendTransaction)
    throw new Error("This wallet cannot send transactions.");
  const bytes = Uint8Array.from(atob(serializedBase64), (c) => c.charCodeAt(0));
  const result = (await provider.signAndSendTransaction(
    Transaction.from(bytes),
  )) as { signature?: unknown } | string | undefined;
  const signature =
    typeof result === "string" ? result : String(result?.signature ?? "");
  if (!signature) throw new Error("The wallet did not return a signature.");
  return signature;
}
