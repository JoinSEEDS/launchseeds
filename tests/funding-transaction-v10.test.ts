import { describe, expect, test } from "bun:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  remainingFunding,
  buildFundingTransaction,
  validateFundingTransaction,
  type FundingLaunch,
  type UnsignedPayment,
} from "../lib/funding-transaction";

const payer = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const secondRecipient = Keypair.generate().publicKey.toBase58();
const blockhash = Keypair.generate().publicKey.toBase58();
const otherBlockhash = Keypair.generate().publicKey.toBase58();
const launch: FundingLaunch = {
  status: "funding",
  fundingWallet: recipient,
  requiredLamports: 520_000_000,
  receivedLamports: 0,
};
const create = (value: FundingLaunch = launch) =>
  buildFundingTransaction({
    launch: value,
    payer,
    blockhash,
    lastValidBlockHeight: 1500,
  });
const check = (payment: UnsignedPayment, value: FundingLaunch = launch) =>
  validateFundingTransaction({ payment, launch: value, payer });

function tamper(
  payment: UnsignedPayment,
  change: (tx: Transaction) => void,
): UnsignedPayment {
  const tx = Transaction.from(
    Uint8Array.from(atob(payment.transaction), (character) =>
      character.charCodeAt(0),
    ),
  );
  change(tx);
  return {
    ...payment,
    transaction: Buffer.from(
      tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ).toString("base64"),
  };
}

describe("launch funding constraints", () => {
  test("funding only allowed while the launch accepts deposits", () => {
    expect(remainingFunding(launch)).toBe(520_000_000);
    for (const status of ["preparing", "deploying", "failed", "live"]) {
      expect(remainingFunding({ ...launch, status })).toBeNull();
    }
  });
  test("funding amount decreases as confirmed deposits arrive", () => {
    expect(remainingFunding({ ...launch, receivedLamports: 100_000_000 })).toBe(
      420_000_000,
    );
  });
  test("fully funded launch accepts no more transfers", () => {
    expect(
      remainingFunding({ ...launch, receivedLamports: 520_000_000 }),
    ).toBeNull();
  });
  test("overfunded launch is not funded twice", () => {
    expect(
      remainingFunding({ ...launch, receivedLamports: 520_000_001 }),
    ).toBeNull();
  });
  test("rejects negative and fractional amounts", () => {
    expect(remainingFunding({ ...launch, receivedLamports: -1 })).toBeNull();
    expect(remainingFunding({ ...launch, receivedLamports: 0.5 })).toBeNull();
    expect(remainingFunding({ ...launch, requiredLamports: 0 })).toBeNull();
    expect(
      remainingFunding({
        ...launch,
        requiredLamports: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
  });
  test("does not accept an invalid deposit address", () => {
    expect(
      remainingFunding({ ...launch, fundingWallet: "not a wallet" }),
    ).toBeNull();
  });
});

describe("build unsigned payment", () => {
  test("returns one exact SOL transfer", () => {
    const payment = create();
    expect(payment.recipient).toBe(recipient);
    expect(payment.amountLamports).toBe(520_000_000);
    expect(payment.blockhash).toBe(blockhash);
    expect(payment.lastValidBlockHeight).toBe(1500);
    const transaction = check(payment);
    expect(transaction.instructions.length).toBe(1);
    expect(
      transaction.instructions[0]!.programId.equals(SystemProgram.programId),
    ).toBe(true);
    expect(transaction.feePayer?.toBase58()).toBe(payer);
  });
  test("does not attach arbitrary instructions", () => {
    const tx = check(create());
    expect(tx.instructions).toHaveLength(1);
  });
  test("never contains a server signature", () => {
    const tx = check(create());
    expect(tx.signatures[0]?.signature).toBeNull();
  });
  test("partial funding uses only remaining lamports", () => {
    const remainingLaunch = { ...launch, receivedLamports: 120_000_000 };
    const payment = create(remainingLaunch);
    expect(payment.amountLamports).toBe(400_000_000);
    expect(check(payment, remainingLaunch)).toBeDefined();
  });
  test("fails closed without a valid blockhash", () => {
    expect(() =>
      buildFundingTransaction({
        launch,
        payer,
        blockhash: "bad",
        lastValidBlockHeight: 1500,
      }),
    ).toThrow();
  });
  test("fails closed for invalid last block height", () => {
    expect(() =>
      buildFundingTransaction({
        launch,
        payer,
        blockhash,
        lastValidBlockHeight: 0,
      }),
    ).toThrow();
    expect(() =>
      buildFundingTransaction({
        launch,
        payer,
        blockhash,
        lastValidBlockHeight: 1.5,
      }),
    ).toThrow();
  });
  test("fails closed for an invalid payer", () => {
    expect(() =>
      buildFundingTransaction({
        launch,
        payer: "fake",
        blockhash,
        lastValidBlockHeight: 1500,
      }),
    ).toThrow();
  });
  test("cannot produce a payment for another status", () => {
    expect(() => create({ ...launch, status: "deploying" })).toThrow();
  });
});

describe("wallet transaction verification before signing", () => {
  const payment = create();
  test("accepts expected one-instruction payment", () => {
    expect(check(payment)).toBeDefined();
  });
  test("rejects different recipient field", () => {
    expect(() => check({ ...payment, recipient: secondRecipient })).toThrow();
  });
  test("rejects a larger transfer amount", () => {
    expect(() => check({ ...payment, amountLamports: 520_000_001 })).toThrow();
  });
  test("rejects a smaller claimed amount than the encoded transfer", () => {
    expect(() => check({ ...payment, amountLamports: 200_000_000 })).toThrow();
  });
  test("rejects noninteger and negative claimed amounts", () => {
    expect(() => check({ ...payment, amountLamports: -1 })).toThrow();
    expect(() => check({ ...payment, amountLamports: 100.5 })).toThrow();
  });
  test("rejects an arbitrary extra instruction", () => {
    const changed = tamper(payment, (transaction) => {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: Keypair.generate().publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 5,
        }),
      );
    });
    expect(() => check(changed)).toThrow("Unexpected transaction instructions");
  });
  test("rejects a changed destination even if the JSON field is unchanged", () => {
    const changed = tamper(payment, (transaction) => {
      transaction.instructions = [
        SystemProgram.transfer({
          fromPubkey: Keypair.generate().publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: payment.amountLamports,
        }),
      ];
    });
    expect(() => check(changed)).toThrow();
  });
  test("rejects changed payer", () => {
    const changed = tamper(payment, (transaction) => {
      transaction.feePayer = Keypair.generate().publicKey;
    });
    expect(() => check(changed)).toThrow();
  });
  test("rejects changed blockhash", () => {
    const changed = tamper(payment, (transaction) => {
      transaction.recentBlockhash = otherBlockhash;
    });
    expect(() => check(changed)).toThrow();
  });
  test("rejects wrong blockhash in the response", () => {
    expect(() => check({ ...payment, blockhash: otherBlockhash })).toThrow();
  });
  test("rejects malformed transaction encoding", () => {
    expect(() => check({ ...payment, transaction: "!invalid!" })).toThrow();
    expect(() =>
      check({ ...payment, transaction: "a".repeat(5000) }),
    ).toThrow();
  });
  test("rejects expired or malformed block validity data", () => {
    expect(() => check({ ...payment, lastValidBlockHeight: -1 })).toThrow();
    expect(() => check({ ...payment, lastValidBlockHeight: NaN })).toThrow();
  });
  test("rejects a previously prepared payment if the launch has moved phases", () => {
    expect(() => check(payment, { ...launch, status: "deploying" })).toThrow();
  });
  test("rejects old amount after a partial deposit arrives", () => {
    expect(() =>
      check(payment, { ...launch, receivedLamports: 100_000_000 }),
    ).toThrow();
  });
});
