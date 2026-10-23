import { createHash } from "node:crypto";
import { z } from "sqlite-zod-orm";
/** Mainnet USDC mint; never infer a treasury balance from another mint. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address");
export const safeInteger = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid integer amount");
  return value;
};
export const positive = (value: number) => {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Expected a finite positive value");
  return value;
};
export const launchInput = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,10}$/)
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().max(1000).default(""),
  image: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "Image must use HTTPS"),
  website: z
    .string()
    .max(200)
    .default("")
    .refine(
      (value) => !value || /^https:\/\//.test(value),
      "Website must use HTTPS",
    ),
  x: z
    .string()
    .max(100)
    .default("")
    .refine(
      (v) => !v || /^@?[A-Za-z0-9_]{1,15}$/.test(v),
      "Enter an X handle such as @launchseeds",
    ),
  telegram: z
    .string()
    .max(100)
    .default("")
    .refine(
      (v) =>
        !v || /^(?:https:\/\/t\.me\/|t\.me\/|@)?[A-Za-z0-9_]{5,32}$/.test(v),
      "Enter a Telegram handle or t.me link",
    ),
  devBuySol: z
    .string()
    .regex(/^\d+(\.\d{1,9})?$/)
    .default("0"),
});
export type LaunchInput = z.input<typeof launchInput>;
export function solToLamports(value: string) {
  if (!/^\d+(\.\d{1,9})?$/.test(value)) throw new Error("Invalid SOL amount");
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  return safeInteger(Number(raw));
}
export type Holder = {
  wallet: string;
  balance: number;
  balanceRaw?: string;
  balanceUi?: string;
  excluded?: string;
};
export function validateHolders(holders: Holder[]) {
  const seen = new Set<string>();
  for (const holder of holders) {
    address.parse(holder.wallet);
    if (seen.has(holder.wallet)) throw new Error("Duplicate holder");
    seen.add(holder.wallet);
    if (!Number.isFinite(holder.balance) || holder.balance < 0)
      throw new Error("Invalid balance");
  }
}
