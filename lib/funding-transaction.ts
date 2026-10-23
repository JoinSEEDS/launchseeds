/** One-payment launch funding constraints shared by the browser and API. */
import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const walletAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface FundingLaunch {
  status: string;
  fundingWallet: string;
  requiredLamports: number;
  receivedLamports: number;
}

export interface UnsignedPayment {
  transaction: string;
  recipient: string;
  amountLamports: number;
  blockhash: string;
  lastValidBlockHeight: number;
}

export function remainingFunding(launch: FundingLaunch): number | null {
  if (
    launch.status !== "funding" ||
    !walletAddressPattern.test(launch.fundingWallet) ||
    !Number.isSafeInteger(launch.requiredLamports) ||
    !Number.isSafeInteger(launch.receivedLamports) ||
    launch.requiredLamports <= 0 ||
    launch.receivedLamports < 0 ||
    launch.receivedLamports >= launch.requiredLamports
  )
    return null;
  const remaining = launch.requiredLamports - launch.receivedLamports;
  return Number.isSafeInteger(remaining) && remaining > 0 ? remaining : null;
}

export function buildFundingTransaction(input: {
  launch: FundingLaunch;
  payer: string;
  blockhash: string;
  lastValidBlockHeight: number;
}): UnsignedPayment {
  const { launch, payer, blockhash, lastValidBlockHeight } = input;
  const remaining = remainingFunding(launch);
  if (remaining === null)
    throw new Error("This launch is not accepting funds.");
  if (!walletAddressPattern.test(payer))
    throw new Error("Invalid wallet address.");
  if (typeof blockhash !== "string" || !walletAddressPattern.test(blockhash))
    throw new Error("Invalid recent blockhash.");
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0)
    throw new Error("Invalid block validity window.");

  const tx = new Transaction({
    feePayer: new PublicKey(payer),
    recentBlockhash: blockhash,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(payer),
      toPubkey: new PublicKey(launch.fundingWallet),
      lamports: remaining,
    }),
  );
  return {
    transaction: Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64"),
    recipient: launch.fundingWallet,
    amountLamports: remaining,
    blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Client-side defensive check of the unsigned transaction before handing it
 * to an external wallet. The wallet still has final authority to authorize.
 * This check rejects extra instructions, unexpected payers, and changed
 * destinations or amounts; it never trusts a recipient string by itself.
 */
export function validateFundingTransaction(input: {
  payment: UnsignedPayment;
  launch: FundingLaunch;
  payer: string;
}): Transaction {
  const { payment, launch, payer } = input;
  const remaining = remainingFunding(launch);
  if (remaining === null)
    throw new Error("Launch funding is no longer available.");
  if (
    !walletAddressPattern.test(payer) ||
    payment.recipient !== launch.fundingWallet ||
    !Number.isSafeInteger(payment.amountLamports) ||
    payment.amountLamports <= 0 ||
    payment.amountLamports > remaining ||
    !walletAddressPattern.test(payment.blockhash) ||
    !Number.isSafeInteger(payment.lastValidBlockHeight) ||
    payment.lastValidBlockHeight <= 0
  )
    throw new Error("Payment details do not match the launch.");
  if (
    typeof payment.transaction !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payment.transaction) ||
    payment.transaction.length > 4096
  )
    throw new Error("Unexpected transaction encoding.");

  // Use browser-safe atob, not Node Buffer. This function also runs in Bun
  // tests and works on the server without a Buffer global dependency.
  const bytes = Uint8Array.from(atob(payment.transaction), (char) =>
    char.charCodeAt(0),
  );
  const transaction = Transaction.from(bytes);
  if (
    transaction.instructions.length !== 1 ||
    !transaction.instructions[0]!.programId.equals(SystemProgram.programId)
  )
    throw new Error("Unexpected transaction instructions.");
  if (
    transaction.recentBlockhash !== payment.blockhash ||
    transaction.feePayer?.toBase58() !== payer
  )
    throw new Error("Unexpected payer or blockhash.");

  const transfer = SystemInstruction.decodeTransfer(
    transaction.instructions[0]!,
  );
  if (
    transfer.fromPubkey.toBase58() !== payer ||
    transfer.toPubkey.toBase58() !== launch.fundingWallet ||
    Number(transfer.lamports) !== payment.amountLamports
  )
    throw new Error("Unexpected transfer amount or recipient.");
  return transaction;
}
