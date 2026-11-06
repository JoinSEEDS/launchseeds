import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { DEFAULT_LAUNCH_SETTINGS, canonicalLaunchSettings } from "../src/domain/launch-settings";
import { LaunchService } from "../src/server/launch";
import { deployerKeypair, deployerInUse, isOwnDeployer, ownDeployerName } from "../src/server/own-deployer";

const now = 1_000_000_000;
const name = ownDeployerName("A".repeat(44));
const token = (over: Record<string, unknown>) => ({ id: 1, status: "live", fundingWalletName: name, quoteExpiresAt: now - 60_000, launchSettingsJson: canonicalLaunchSettings(DEFAULT_LAUNCH_SETTINGS), ...over });
const repoOf = (tokens: any[], runStatus = "holding") => {
  const expired: number[] = [];
  return {
    expired,
    tokens: {
      all: () => tokens,
      byFundingWalletName: (n: string) => tokens.filter((t) => t.fundingWalletName === n),
      expireFunding: (id: number) => { expired.push(id); tokens.find((t) => t.id === id).status = "expired"; return true; },
    },
    userBatches: { byToken: () => [{ stateJson: JSON.stringify({ status: runStatus }) }] },
  } as any;
};

test("a private key reads as base58 or a byte array", () => {
  const pair = Keypair.generate();
  expect(deployerKeypair(bs58.encode(pair.secretKey)).publicKey.equals(pair.publicKey)).toBe(true);
  expect(deployerKeypair(JSON.stringify([...pair.secretKey])).publicKey.equals(pair.publicKey)).toBe(true);
});
test("a bad key is refused without repeating it", () => {
  let message = "";
  try { deployerKeypair("not-a-real-secret-0OIl"); } catch (error) { message = (error as Error).message; }
  expect(message).toBe("Enter a valid private key.");
});
test("only launcher wallets carry the deployer name", () => {
  expect(isOwnDeployer(name)).toBe(true);
  expect(isOwnDeployer("launchseeds-abc")).toBe(false);
  expect(isOwnDeployer(null)).toBe(false);
});
test("the key stays until the tranches have bought", () => {
  expect(deployerInUse(repoOf([token({})], "waiting"), name, now)).toBe(true);
  expect(deployerInUse(repoOf([token({})], "buying"), name, now)).toBe(true);
  expect(deployerInUse(repoOf([token({})], "holding"), name, now)).toBe(false);
});
test("a launch funded early keeps its key until its scheduled time passes", () => {
  const settings = canonicalLaunchSettings({ ...DEFAULT_LAUNCH_SETTINGS, scheduledAt: now + 3_600_000, holderRewards: true, sniperSeconds: null, bundleLamports: 100_000_000, walletSharesBps: [3334, 3333, 3333], profitPolicy: { mode: "token" }, boost: { durationMs: 3_600_000, steps: 6 } });
  expect(deployerInUse(repoOf([token({ status: "funding", launchSettingsJson: settings })]), name, now)).toBe(true);
});
test("finished launches lose the key, and a missed launch expires first", () => {
  const forgotten: string[] = [];
  const repo = repoOf([token({ id: 1, status: "funding", quoteExpiresAt: now - 3_600_000 }), token({ id: 2, fundingWalletName: "launchseeds-other" })]);
  new LaunchService({ repo } as any, { forgetWallet: (n: string) => forgotten.push(n) } as any).forgetFinishedDeployers(now);
  expect(repo.expired).toEqual([1]);
  expect(forgotten).toEqual([name]);
});
test("a launch still using the wallet keeps the key for every coin on it", () => {
  const forgotten: string[] = [];
  const repo = repoOf([token({ id: 1, status: "failed" }), token({ id: 2, status: "deploying" })]);
  new LaunchService({ repo } as any, { forgetWallet: (n: string) => forgotten.push(n) } as any).forgetFinishedDeployers(now);
  expect(forgotten).toEqual([]);
});
