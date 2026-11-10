import { expect, test } from "bun:test";
import { DEFAULT_LAUNCH_SETTINGS, canonicalLaunchSettings } from "../src/domain/launch-settings";
import { LAUNCH_GIVE_UP_MS, LaunchService } from "../src/server/launch";

const at = 1_000_000_000;
const fake = (scheduledAt: number | null) => {
  const token: any = { id: 7, status: "deploying", launchSettingsJson: canonicalLaunchSettings({ ...DEFAULT_LAUNCH_SETTINGS, scheduledAt, holderRewards: true, sniperSeconds: null, bundleLamports: 100_000_000, walletSharesBps: [3334, 3333, 3333], profitPolicy: { mode: "token" }, boost: { durationMs: 3_600_000, steps: 6 } } as never) };
  const runs = [{ id: 1, revision: 3, stateJson: JSON.stringify({ status: "buying" }) }];
  const saved: string[] = [];
  const repo: any = {
    tokens: {
      get: () => token,
      transition: (_id: number, from: string, to: string, patch: any) => token.status === from && Object.assign(token, { status: to }, patch),
    },
    userBatches: { byToken: () => runs, save: (_id: number, _rev: number, json: string) => saved.push(JSON.parse(json).status) },
  };
  repo.tx = (fn: any) => fn(repo);
  return { service: new LaunchService({ repo } as any, {} as any), token, saved };
};

test("an expired launch long past its time fails instead of rebuilding, and skips its columns", () => {
  const f = fake(at);
  expect(f.service.giveUpExpired(7, at + LAUNCH_GIVE_UP_MS + 1)).toBe(true);
  expect(f.token.status).toBe("failed");
  expect(f.token.error).toContain("Nothing was created on chain");
  expect(f.saved).toEqual(["skipped"]);
});
test("an expired launch close to its time is still rebuilt", () => {
  const f = fake(at);
  expect(f.service.giveUpExpired(7, at + 60_000)).toBe(false);
  expect(f.token.status).toBe("deploying");
});
