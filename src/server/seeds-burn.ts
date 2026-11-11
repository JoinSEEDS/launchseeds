/** Runs an admin-authorized $SEEDS buyback and burn from the treasury, one step
 * per tick: buy $SEEDS with the authorized SOL, then burn exactly what was
 * bought. Every step is saved before it is sent and resumes after a restart.
 * Anything that doesn't add up stops in review for an admin; nothing is guessed. */
import type { LaunchseedsRepo } from "../db/repo";

export type BurnSigned = { transaction: string; signature: string; lastValidBlockHeight: number };
export type SeedsBurnChain = {
  treasuryLamports(): Promise<bigint>;
  /** True while a launch is using the treasury. */
  busy(): boolean;
  /** Buys $SEEDS with `lamports`; the same `intentKey` resumes the same buy. */
  buy(mint: string, lamports: bigint, intentKey: string): Promise<string>;
  /** "pending" until finalized; what the treasury got and paid in that transaction. */
  buyReceipt(signature: string, mint: string): Promise<"pending" | "failed" | { bought: bigint; spent: bigint }>;
  /** A signed burn of `amount` of the treasury's $SEEDS; not sent. */
  prepareBurn(mint: string, amount: bigint): Promise<BurnSigned>;
  send(transaction: string): Promise<void>;
  status(signature: string): Promise<"finalized" | "confirmed" | "failed" | "pending" | "unknown">;
  expired(height: number): Promise<boolean>;
  /** The treasury's $SEEDS balance in raw units. */
  tokenBalance(mint: string): Promise<bigint>;
  fee(signature: string): Promise<bigint>;
};
/** Kept in the treasury on top of a buyback for network fees and token-account rent. */
export const BURN_MARGIN = 10_000_000n;
/** A buy may cost a little more than its amount (fees, account rent); more than this goes to review. */
const BUY_SLACK = 5_000_000n;

export async function tickSeedsBurn(repo: Pick<LaunchseedsRepo, "challenges">, chain: SeedsBurnChain, now = Date.now()): Promise<string[]> {
  const c = repo.challenges, row = c.activeSeedsBurn();
  if (!row) return [];
  const label = `seeds burn ${row.id}`, amount = BigInt(row.lamports);
  const review = (error: string) => { c.moveSeedsBurn(row.id, row.status, { status: "review", error }, now); return [`${label}: review: ${error}`]; };
  try {
    if (row.status === "queued") {
      if (chain.busy()) return [`${label}: waiting for a launch to finish`];
      if ((await chain.treasuryLamports()) < amount + BURN_MARGIN) return [`${label}: waiting for treasury SOL`];
      c.moveSeedsBurn(row.id, "queued", { status: "buying" }, now);
      return [`${label}: buying`];
    }
    if (row.status === "buying") {
      let signature = row.buySignature;
      if (!signature) {
        signature = await chain.buy(row.mint, amount, `seeds-burn-${row.requestKey}`);
        c.moveSeedsBurn(row.id, "buying", { status: "buying", buySignature: signature, error: null }, now);
      }
      const receipt = await chain.buyReceipt(signature, row.mint);
      if (receipt === "pending") return [`${label}: buy ${signature} not final yet`];
      if (receipt === "failed") return review(`Buy ${signature} failed on chain; nothing was bought`);
      if (receipt.bought <= 0n || receipt.spent <= 0n || receipt.spent > amount + BUY_SLACK) return review(`Buy ${signature} spent ${receipt.spent} lamports for ${receipt.bought} tokens; check it`);
      c.moveSeedsBurn(row.id, "buying", { status: "bought", boughtRaw: receipt.bought.toString(), buySpentLamports: receipt.spent.toString() }, now);
      return [`${label}: bought ${receipt.bought}`];
    }
    const bought = BigInt(row.boughtRaw ?? "0");
    if (row.status === "bought") {
      if ((await chain.tokenBalance(row.mint)) < bought) return review("The treasury holds less $SEEDS than was bought");
      const signed = await chain.prepareBurn(row.mint, bought);
      if (!c.moveSeedsBurn(row.id, "bought", { status: "burning", burnJson: JSON.stringify(signed), burnSignature: signed.signature }, now)) return [];
      await chain.send(signed.transaction);
      return [`${label}: burn sent`];
    }
    if (row.status === "burning") {
      const signed = JSON.parse(row.burnJson ?? "null") as BurnSigned | null;
      if (!signed) return review("Burn journal missing");
      const status = await chain.status(signed.signature);
      if (status === "finalized") {
        const spent = BigInt(row.buySpentLamports ?? row.lamports) + (await chain.fee(signed.signature));
        c.moveSeedsBurn(row.id, "burning", { status: "done", spentLamports: spent.toString(), doneAt: now, error: null }, now);
        return [`${label}: burned ${bought}`];
      }
      if (status === "failed" || (status === "unknown" && (await chain.expired(signed.lastValidBlockHeight)) && (await chain.status(signed.signature)) === "unknown")) {
        // A burn can only burn tokens the treasury still holds, so rebuilding is
        // safe; but if they are gone, the first burn landed and RPC can't show it.
        if ((await chain.tokenBalance(row.mint)) < bought) return review(`Burn ${signed.signature} not found but the tokens are gone; check it landed`);
        c.moveSeedsBurn(row.id, "burning", { status: "bought", burnJson: null, burnSignature: null, error: `Burn ${signed.signature} did not land; rebuilding` }, now);
        return [`${label}: burn did not land, rebuilding`];
      }
      if (status !== "confirmed" && !(await chain.expired(signed.lastValidBlockHeight))) await chain.send(signed.transaction);
      return [`${label}: burn ${status}`];
    }
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unavailable";
    c.moveSeedsBurn(row.id, row.status, { status: row.status, error: message.slice(0, 300) }, now);
    return [`${label}: ${message}`];
  }
}
