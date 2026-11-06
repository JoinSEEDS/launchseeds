/** A launch deployed from the launcher's own wallet. The key is held only
 * while a launch needs it, and never in a token row or the launch input. */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { ApiError } from "../../lib/api-security";
import type { LaunchseedsRepo } from "../db/repo";
import type { Token } from "../db/schema";
import { storedLaunchSettings } from "../domain/launch-settings";

type DeployerRepo = Pick<LaunchseedsRepo, "tokens" | "userBatches">;
const PREFIX = "launchseeds-deployer-";
export const ownDeployerName = (address: string) => `${PREFIX}${address}`;
export const isOwnDeployer = (walletName?: string | null) => !!walletName?.startsWith(PREFIX);

/** A base58 or JSON byte-array secret key. Errors never repeat the input. */
export function deployerKeypair(privateKey: string) {
  try {
    const text = privateKey.trim();
    const bytes = text.startsWith("[") ? Uint8Array.from(JSON.parse(text) as number[]) : bs58.decode(text);
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new ApiError("Enter a valid private key.", 400);
  }
}

/** How long past its deadline an unfinished launch keeps the key, so a launch
 * the worker is about to start is never cut off. */
const GRACE_MS = 10 * 60_000;
const BUYING = new Set(["waiting", "buying"]);

/** Whether this launch can still sign with its deployer: tranches pay from it
 * after the coin is live. */
export function needsDeployer(repo: DeployerRepo, token: Token, now = Date.now()) {
  if (token.status === "preparing" || token.status === "deploying") return true;
  if (token.status === "funding") {
    const deadline = Math.max(token.quoteExpiresAt ?? 0, storedLaunchSettings(token.launchSettingsJson).scheduledAt ?? 0);
    return now <= deadline + GRACE_MS;
  }
  if (token.status !== "live") return false;
  return repo.userBatches.byToken(token.id).some((row) => BUYING.has((JSON.parse(row.stateJson) as { status: string }).status));
}

export const deployerInUse = (repo: DeployerRepo, name: string, now = Date.now()) =>
  repo.tokens.byFundingWalletName(name).some((token) => needsDeployer(repo, token, now));
