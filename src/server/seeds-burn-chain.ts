/** The chain side of a $SEEDS buyback and burn, signed by the treasury wallet. */
import { PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import bs58 from "bs58";
import type { TraderClient } from "./solard-sdk";
import type { SeedsBurnChain } from "./seeds-burn";

const solString = (lamports: bigint) => `${lamports / 1_000_000_000n}.${(lamports % 1_000_000_000n).toString().padStart(9, "0")}`;

export function seedsBurnChain(input: { connection: Connection; trader: TraderClient; treasury: string; walletName: string; busy: () => boolean }): SeedsBurnChain {
  const { connection, trader, treasury, walletName } = input;
  const owner = new PublicKey(treasury);
  const signer = () => {
    const s = trader.signer(walletName);
    if (s.publicKey.toBase58() !== treasury) throw new Error("Treasury signer mismatch");
    return s;
  };
  const program = async (mint: PublicKey) => {
    const info = await connection.getAccountInfo(mint, "finalized");
    if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    if (info?.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
    throw new Error("Unsupported $SEEDS mint program");
  };
  return {
    treasuryLamports: async () => BigInt(await connection.getBalance(owner, "confirmed")),
    busy: input.busy,
    async buy(mint, lamports, intentKey) {
      signer();
      await trader.addToken(mint);
      const result = await trader.buy(mint, walletName, { sol: solString(lamports) }, { intentKey, slippageBps: 300 });
      if (!result.signature) throw new Error(`Buy is ${result.status}; will resume the same buy`);
      return result.signature;
    },
    async buyReceipt(signature, mint) {
      const tx = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      if (!tx?.meta) return "pending";
      if (tx.meta.err) return "failed";
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      if (keys.get(0)?.toBase58() !== treasury) throw new Error("The buy was not paid by the treasury");
      const held = (balances: typeof tx.meta.postTokenBalances) =>
        (balances ?? []).filter((b) => b.owner === treasury && b.mint === mint).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
      return { bought: held(tx.meta.postTokenBalances) - held(tx.meta.preTokenBalances), spent: BigInt(tx.meta.preBalances[0]!) - BigInt(tx.meta.postBalances[0]!) };
    },
    async prepareBurn(mint, amount) {
      const payer = signer(), mintKey = new PublicKey(mint), tokenProgram = await program(mintKey);
      const { decimals } = await getMint(connection, mintKey, "finalized", tokenProgram);
      const ata = getAssociatedTokenAddressSync(mintKey, owner, false, tokenProgram);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const message = new TransactionMessage({
        payerKey: owner, recentBlockhash: blockhash,
        instructions: [createBurnCheckedInstruction(ata, mintKey, owner, amount, decimals, [], tokenProgram)],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.sign([payer]);
      const sim = await connection.simulateTransaction(tx, { sigVerify: false });
      if (sim.value.err) throw new Error(`Burn simulation failed: ${JSON.stringify(sim.value.err)}`);
      return { transaction: Buffer.from(tx.serialize()).toString("base64"), signature: bs58.encode(tx.signatures[0]!), lastValidBlockHeight };
    },
    async send(transaction) {
      await connection.sendRawTransaction(Buffer.from(transaction, "base64"), { skipPreflight: false, maxRetries: 3 });
    },
    async status(signature) {
      const s = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!s) return "unknown";
      if (s.err) return "failed";
      return s.confirmationStatus === "finalized" ? "finalized" : s.confirmationStatus === "confirmed" ? "confirmed" : "pending";
    },
    expired: async (height) => (await connection.getBlockHeight("finalized")) > height,
    async tokenBalance(mint) {
      const mintKey = new PublicKey(mint);
      const ata = getAssociatedTokenAddressSync(mintKey, owner, false, await program(mintKey));
      try {
        return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
      } catch {
        return 0n;
      }
    },
    async fee(signature) {
      const tx = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      return BigInt(tx?.meta?.fee ?? 0);
    },
  };
}
