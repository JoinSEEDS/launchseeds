import { createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";
/** Checks that `wallet` signed `message` (base58 signature). */
export interface SignatureVerifier {
  verify(input: { wallet: string; signature: string; message: string }): Promise<boolean>;
}
export const ed25519VoteVerifier: SignatureVerifier = {
  async verify({ wallet, signature, message }) {
    try {
      const key = bs58.decode(wallet),
        sig = bs58.decode(signature);
      if (key.length !== 32 || sig.length !== 64) return false;
      const pub = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(key),
        ]),
        format: "der",
        type: "spki",
      });
      return verify(null, Buffer.from(message, "utf8"), pub, sig);
    } catch {
      return false;
    }
  },
};
