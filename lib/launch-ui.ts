import type { ScheduledLaunchView } from "../src/server/scheduled-launches";
import { coinPath } from "./coin-url";
import type { LaunchSettings } from "../src/domain/launch-settings";
import { MAX_TOKEN_IMAGE_BYTES, TOKEN_IMAGE_SIZE_ERROR } from "./media-policy";
import { validTelegram, normalizeX, validX } from "./launch-socials";
import { DESCRIPTION, type Strategy } from "./strategy";

/** Public statuses exposed by the canonical launch service. */
export type LaunchPhase =
  "preparing" | "funding" | "deploying" | "live" | "failed";

export interface PublicLaunchStatus {
  website?: string;
  x?: string;
  telegram?: string;
  description?: string;
  /** Private launch-status handle (not a database id). */
  handle: string;
  status: LaunchPhase;
  name: string;
  symbol: string;
  fundingWallet: string;
  requiredLamports: number;
  receivedLamports: number;
  mint: string;
  launchSignature: string;
  error: string;
  devBuyLamports?: number;
  rewardFundVerified?: boolean;
  settings?: LaunchSettings;
  plan?: ScheduledLaunchView | null;
  /** Quote expiry (ms); the funding address is valid until then. */
  expiresAt?: number;
}

export interface LaunchFormFields {
  name: string;
  symbol: string;
  devBuySol: string;
  /** Empty: the default description. */
  description?: string;
  /** Empty: the coin's own LaunchSeeds page. */
  website: string;
  x: string;
  telegram: string;
  image: string;
  firstStrategy: Strategy | null;
  settings: LaunchSettings;
}

export interface LaunchView {
  phase: LaunchPhase;
  isComplete: boolean;
  canFund: boolean;
  showAddress: boolean;
  showTokenLink: boolean;
  waiting: boolean;
  title: string;
  message: string;
  progress: number;
  requiredSol: string;
  receivedSol: string;
}

const walletAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** sha256(CA) prefix, or a pre-2026-10-25 launch id. */
const handlePattern =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * On failed or preparing launches, do not expose a stale address or invite
 * deposits. A funding wallet is only actionable in the funding phase.
 */
export function launchView(status: PublicLaunchStatus): LaunchView {
  const phase = status.status;
  const required = safeLamports(status.requiredLamports);
  const received = safeLamports(status.receivedLamports);
  const hasAddress = walletAddress.test(status.fundingWallet);
  const canFund =
    phase === "funding" &&
    hasAddress &&
    required > 0 &&
    received < required &&
    (!status.settings?.scheduledAt ||
      Date.now() <
        Math.min(status.settings.scheduledAt, status.expiresAt ?? Infinity));
  const funded = required > 0 && received >= required;
  const progress =
    required > 0 ? Math.min(100, (received / required) * 100) : 0;
  const message =
    phase === "failed"
      ? status.error || "Launch needs operator attention. Do not send funds."
      : phase === "preparing"
        ? "Preparing a unique funding address. Do not send funds yet."
        : phase === "funding"
          ? hasAddress
            ? funded && status.settings?.scheduledAt
              ? status.error ||
                (Date.now() < status.settings.scheduledAt
                  ? `Funded. Scheduled for ${new Date(status.settings.scheduledAt).toISOString()}.`
                  : "Scheduled time reached. Preparing the launch; any delay will be shown here.")
              : status.settings?.scheduledAt &&
                  Date.now() >=
                    Math.min(
                      status.settings.scheduledAt,
                      status.expiresAt ?? Infinity,
                    )
                ? "Payment deadline passed. Do not send funds. Late payments require refund review."
                : `Waiting for a confirmed deposit. ${formatLamports(received)} SOL received.`
            : "Funding address unavailable. Do not send funds."
          : phase === "deploying"
            ? "Deposit confirmed. Deployment is in progress."
            : phase === "live"
              ? "Token deployed. Open the token page to see its treasury."
              : "Launch status is unavailable.";
  return {
    phase,
    isComplete: phase === "live" || phase === "failed",
    canFund,
    showAddress: canFund,
    showTokenLink: phase === "live" && Boolean(status.mint),
    waiting:
      phase === "preparing" || phase === "funding" || phase === "deploying",
    title: phase === "live" ? "LIVE" : phase.toUpperCase(),
    message,
    progress: funded ? 100 : progress,
    requiredSol: formatLamports(required),
    receivedSol: formatLamports(received),
  };
}

export function safeLamports(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

export function formatLamports(lamports: number): string {
  const value = safeLamports(lamports);
  const whole = Math.floor(value / 1e9);
  const fraction = String(value % 1e9)
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function parseSol(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount =
    BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return amount;
}

export function launchTotal(devBuySol: string, baseFeeLamports: number) {
  const amount = parseSol(devBuySol);
  if (
    amount === null ||
    !Number.isSafeInteger(baseFeeLamports) ||
    baseFeeLamports < 0
  ) {
    return null;
  }
  const total = amount + BigInt(baseFeeLamports);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return formatLamports(Number(total));
}

export function validateImage(file: File | null): string | null {
  if (!file) return "Choose a token image.";
  if (
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)
  ) {
    return "Use a PNG, JPEG, GIF or WebP token image.";
  }
  if (file.size <= 0) return "The image file is empty.";
  if (file.size > MAX_TOKEN_IMAGE_BYTES) return TOKEN_IMAGE_SIZE_ERROR;
  return null;
}

/** Validation shared by the launch UI and form-level regression tests. */
export function validateLaunchFields(fields: LaunchFormFields): string | null {
  if (!fields.name.trim() || fields.name.trim().length > 32) {
    return "Enter a token name up to 32 characters.";
  }
  if (!/^[A-Za-z0-9]{1,10}$/.test(fields.symbol.trim())) {
    return "Use 1–10 letters or digits for the ticker.";
  }
  if (parseSol(fields.devBuySol) === null) {
    return "Enter a valid initial reward fund amount in SOL, with up to nine decimals.";
  }
  if ((fields.description ?? "").trim().length > 4000) {
    return "Keep the description under 4,000 characters.";
  }
  if (
    fields.website.trim() &&
    !/^https:\/\/[^\s]+$/i.test(fields.website.trim())
  ) {
    return "Website must begin with https://.";
  }
  if (!validX(fields.x)) {
    return "Enter an X handle or an X profile, community or post link, or leave it blank.";
  }
  if (!validTelegram(fields.telegram)) {
    return "Enter a Telegram handle or t.me link, or leave it blank.";
  }
  if (!fields.firstStrategy && fields.settings.scheduledAt === null)
    return "Choose a starting strategy.";
  return null;
}

export function buildLaunchPayload(fields: LaunchFormFields) {
  return {
    name: fields.name.trim(),
    symbol: fields.symbol.trim().toUpperCase(),
    description: fields.description?.trim() || DESCRIPTION,
    image: fields.image,
    website: fields.website.trim(),
    x: normalizeX(fields.x),
    telegram: fields.telegram.trim(),
    devBuySol: fields.devBuySol,
    firstStrategy: fields.firstStrategy,
    settings: fields.settings,
  };
}

/** The public launch URL identifies a read-only operation, not a capability. */
export function launchUrl(handle: string): string | null {
  return handlePattern.test(handle)
    ? `/launch?launch=${encodeURIComponent(handle)}`
    : null;
}

/** Token pages are addressed by CA, which only exists once the token is live. */
export function publicTokenUrl(mint: string): string | null {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? coinPath(mint) : null;
}

/** Guard against malformed responses from reverse proxies or failed migrations. */
export function validLaunchStatus(value: unknown): value is PublicLaunchStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const phases: LaunchPhase[] = [
    "preparing",
    "funding",
    "deploying",
    "live",
    "failed",
  ];
  return (
    typeof data.handle === "string" &&
    handlePattern.test(data.handle) &&
    phases.includes(data.status as LaunchPhase) &&
    typeof data.name === "string" &&
    typeof data.symbol === "string" &&
    typeof data.fundingWallet === "string" &&
    typeof data.mint === "string" &&
    typeof data.launchSignature === "string" &&
    typeof data.error === "string" &&
    typeof data.requiredLamports === "number" &&
    typeof data.receivedLamports === "number"
  );
}

export function phaseClass(phase: LaunchPhase): string {
  return phase === "live"
    ? "pill pill--active"
    : phase === "failed"
      ? "pill pill--error"
      : "pill pill--wait";
}
