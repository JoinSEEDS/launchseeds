import { expect, test } from "bun:test";
import {
  DEFAULT_LAUNCH_SETTINGS,
  canonicalLaunchSettings,
  durationText,
  elapsedText,
  parseLaunchSettings,
  proceedsWallet,
  storedLaunchSettings,
} from "../src/domain/launch-settings";

const wallet = "1".repeat(32);
const columns = { proceedsWallet: "2".repeat(32), columns: [{ slots: [100_000_000, 100_000_000], exit: { kind: "floor" as const, usd: 5000 } }] };
const scheduled = { ...DEFAULT_LAUNCH_SETTINGS, scheduledAt: 1_900_000_000_000, userBatches: columns, bundleLamports: 200_000_000, feesTo: wallet };

test("defaults publish the CA and project and choose nothing else", () => {
  expect(parseLaunchSettings({})).toEqual(DEFAULT_LAUNCH_SETTINGS);
  expect(storedLaunchSettings(null)).toEqual(DEFAULT_LAUNCH_SETTINGS);
});
test("a scheduled launch round-trips through its canonical JSON", () => {
  const json = canonicalLaunchSettings(scheduled);
  expect(storedLaunchSettings(json)).toEqual(parseLaunchSettings(scheduled));
  expect(proceedsWallet(parseLaunchSettings(scheduled))).toBe("2".repeat(32));
});
test("a scheduled launch needs columns, a matching launch buy and a fee wallet", () => {
  expect(() => parseLaunchSettings({ ...scheduled, userBatches: null })).toThrow();
  expect(() => parseLaunchSettings({ ...scheduled, feesTo: null })).toThrow();
  expect(() => parseLaunchSettings({ ...scheduled, bundleLamports: 300_000_000 })).toThrow();
  expect(() => parseLaunchSettings({ ...scheduled, feesTo: "not-an-address" })).toThrow();
});
test("unknown or retired settings are refused", () => {
  expect(() => parseLaunchSettings({ ...scheduled, holderRewards: true })).toThrow();
  expect(() => parseLaunchSettings({ ...scheduled, boost: null })).toThrow();
  expect(() => storedLaunchSettings("{not json")).toThrow("Operator review required");
});
test("human-facing durations are deterministic", () => {
  expect(elapsedText(41 * 60_000)).toBe("41m");
  expect(elapsedText((3 * 60 + 12) * 60_000)).toBe("3h 12m");
  expect(elapsedText((2 * 24 + 9) * 3_600_000)).toBe("2d 9h");
  expect(durationText(604800000)).toBe("7d");
});
