import { validTelegram, normalizeX, validX } from "../../lib/launch-socials";
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
  image: z.string().refine(value => /^\/api\/media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value) || /^https:\/\//.test(value), "Use an uploaded token image or HTTPS image URL"),
  website: z
    .string()
    .trim()
    .max(200)
    .default("")
    .refine(
      (value) => !value || /^https:\/\//.test(value),
      "Website must use HTTPS",
    ),
  x: z
    .string()
    .trim()
    .max(100)
    .default("")
    .refine(
      (v) => validX(v),
      "Enter an X handle or an X profile, community or post link",
    )
    .transform(normalizeX),
  telegram: z
    .string()
    .trim()
    .max(100)
    .default("")
    .refine(
      (v) =>
        validTelegram(v),
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
