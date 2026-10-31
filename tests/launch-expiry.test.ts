import { expect, test } from "bun:test";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { SolardLaunchProvider } from "../src/server/solard";
import { LaunchService, type LaunchProvider } from "../src/server/launch";
import type { TraderClient } from "../src/server/solard-sdk";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";

function fixture() {
  const payer = Keypair.generate(),
    mint = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: 1,
          space: 0,
          programId: SystemProgram.programId,
        }),
      ],
    }).compileToV0Message(),
  );
  tx.sign([payer, mint]);
  const intent = JSON.stringify({
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    signature: bs58.encode(tx.signatures[0]!),
    mint: mint.publicKey.toBase58(),
    lastValidBlockHeight: 100,
  });
  const store = new Store(openLaunchseedsData(":memory:"));
  const sdk = {
    signer: (address: string) => {
      const key = [payer, mint].find((k) => k.publicKey.toBase58() === address);
      if (!key) throw new Error("Unknown signer");
      return key;
    },
  } as TraderClient;
  const provider = new SolardLaunchProvider(
    sdk,
    store,
    "https://api.mainnet-beta.solana.com",
    20_000_000,
  );
  const fresh = Keypair.generate().publicKey.toBase58();
  let sends = 0;
  Object.assign(provider.connection, {
    getBlockHeight: async () => 200,
    isBlockhashValid: async () => ({ value: false }),
    getSignatureStatuses: async () => ({ value: [null] }),
    getTransaction: async () => null,
    getAccountInfo: async () => null,
    getLatestBlockhash: async () => ({
      blockhash: fresh,
      lastValidBlockHeight: 350,
    }),
    sendRawTransaction: async () => {
      sends++;
      return "submitted";
    },
  });
  return { store, provider, intent, tx, fresh, sends: () => sends };
}

test("renewal preserves instructions and mint, archives old signed bytes, and does not broadcast", async () => {
  const f = fixture();
  try {
    expect((await f.provider.executeDeployment(f.intent)).status).toBe(
      "expired",
    );
    const renewed = JSON.parse(await f.provider.refreshDeployment(f.intent));
    const tx = VersionedTransaction.deserialize(
      Buffer.from(renewed.transaction, "base64"),
    );
    expect(tx.message.recentBlockhash).toBe(f.fresh);
    expect(tx.message.compiledInstructions).toEqual(
      f.tx.message.compiledInstructions,
    );
    expect(tx.message.staticAccountKeys).toEqual(
      f.tx.message.staticAccountKeys,
    );
    expect(renewed.mint).toBe(JSON.parse(f.intent).mint);
    expect(renewed.signature).not.toBe(JSON.parse(f.intent).signature);
    expect(renewed.superseded).toEqual([JSON.parse(f.intent)]);
    expect(f.sends()).toBe(0);
  } finally {
    f.store.close();
  }
});

test("renewal fails closed for unexpired, observed, ambiguous and failed outcomes", async () => {
  for (const patch of [
    { getBlockHeight: async () => 100 },
    { isBlockhashValid: async () => ({ value: true }) },
    {
      getSignatureStatuses: async () => ({
        value: [{ confirmationStatus: "processed" }],
      }),
    },
    {
      getSignatureStatuses: async () => ({
        value: [{ err: { InstructionError: [0, "failure"] } }],
      }),
    },
    { getTransaction: async () => ({ slot: 123 }) },
    { getAccountInfo: async () => ({ owner: SystemProgram.programId }) },
    {
      getSignatureStatuses: async () => {
        throw new Error("RPC unavailable");
      },
    },
  ]) {
    const f = fixture();
    try {
      Object.assign(f.provider.connection, patch);
      await expect(f.provider.refreshDeployment(f.intent)).rejects.toThrow();
      expect(f.sends()).toBe(0);
    } finally {
      f.store.close();
    }
  }
});

test("service persists a renewed intent before sending and resumes the same funded token", async () => {
  const f = fixture();
  try {
    const token = insertToken(f.store, {
      status: "deploying",
      intent: f.intent,
      fundingReceivedLamports: "20000000",
    });
    const replacement = await f.provider.refreshDeployment(f.intent);
    let calls = 0;
    const provider = {
      refreshDeployment: async () => replacement,
      executeDeployment: async (intent: string) => {
        calls++;
        expect(f.store.repo.tokens.get(token.id)?.intent).toBe(intent);
        return {
          status: intent === f.intent ? "expired" : "confirmed",
          signature: "confirmed-proof",
          mint: JSON.parse(f.intent).mint,
        };
      },
    } as unknown as LaunchProvider;
    await new LaunchService(f.store, provider).process(token.id);
    expect(calls).toBe(2);
    expect(f.store.repo.tokens.get(token.id)?.status).toBe("live");
    expect(f.store.repo.tokens.get(token.id)?.mint).toBe(
      JSON.parse(f.intent).mint,
    );
    expect(f.store.repo.tokens.get(token.id)?.fundingReceivedLamports).toBe(
      "20000000",
    );
  } finally {
    f.store.close();
  }
});

test("confirmed transactions are never rebroadcast and pending sends enable RPC retries", async () => {
  const f = fixture();
  try {
    Object.assign(f.provider.connection, {
      getSignatureStatuses: async () => ({
        value: [{ confirmationStatus: "confirmed", err: null }],
      }),
    });
    expect((await f.provider.executeDeployment(f.intent)).status).toBe(
      "confirmed",
    );
    expect(f.sends()).toBe(0);
    let retries = 0;
    Object.assign(f.provider.connection, {
      getSignatureStatuses: async () => ({ value: [null] }),
      getBlockHeight: async () => 99,
      sendRawTransaction: async (
        _bytes: Uint8Array,
        options: { maxRetries: number },
      ) => {
        retries = options.maxRetries;
        return "submitted";
      },
    });
    expect((await f.provider.executeDeployment(f.intent)).status).toBe(
      "pending",
    );
    expect(retries).toBe(3);
  } finally {
    f.store.close();
  }
});

test("sponsorship submission checks its saved signature, confirmation and expiry", async () => {
  const f = fixture();
  try {
    const payment = JSON.parse(f.intent);
    await expect(f.provider.sendPrepared(payment)).rejects.toThrow("expired");
    expect(f.sends()).toBe(0);
    Object.assign(f.provider.connection, { getBlockHeight: async () => 99 });
    await f.provider.sendPrepared(payment);
    expect(f.sends()).toBe(1);
    Object.assign(f.provider.connection, {
      getSignatureStatuses: async () => ({
        value: [{ confirmationStatus: "finalized", err: null }],
      }),
    });
    await f.provider.sendPrepared(payment);
    expect(f.sends()).toBe(1);
    await expect(
      f.provider.sendPrepared({ ...payment, signature: "mismatch" }),
    ).rejects.toThrow("signature mismatch");
  } finally {
    f.store.close();
  }
});
