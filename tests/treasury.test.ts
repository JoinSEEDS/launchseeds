import { expect, test } from "bun:test";
import { dailyLoss, dailyLossLimit, launchHoldsTreasury, maxBundleLamports, MIN_SEED_BUY_LAMPORTS, SEED_WALLETS, seedBuys, seedLimit, TREASURY_RESERVE_LAMPORTS, TREASURY_WALLET } from "../src/server/treasury";

const overhead = TREASURY_RESERVE_LAMPORTS + 1_000_000n + 100_000n + 4n * 14_000_000n;

test("the bundle buys the configured size, split over four wallets", () => {
  const buys = seedBuys(10_000_000_000n, 1_000_000n, 500_000_000n)!;
  expect(buys).toHaveLength(SEED_WALLETS);
  expect(buys.reduce((a, b) => a + b, 0n)).toBe(500_000_000n);
});
test("a treasury below the configured size spends only what it can, never the reserve", () => {
  const buys = seedBuys(400_000_000n, 1_000_000n, 2_000_000_000n)!;
  const spent = buys.reduce((a, b) => a + b, 0n);
  expect(spent + overhead).toBeLessThanOrEqual(400_000_000n);
  expect(400_000_000n - spent - overhead).toBeLessThan(4n);
});
test("SOL owed to coins' bounty pools is never spent", () => {
  expect(seedBuys(1_000_000_000n, 0n, 2_000_000_000n, 900_000_000n)).toBeNull();
  const buys = seedBuys(1_000_000_000n, 0n, 2_000_000_000n, 300_000_000n)!;
  expect(buys.reduce((a, b) => a + b, 0n) + 300_000_000n + overhead - 1_000_000n).toBeLessThanOrEqual(1_000_000_000n);
});
test("a treasury too low for the smallest buys launches nothing", () => {
  expect(seedBuys(200_000_000n, 1_000_000n, 1_000_000_000n)).toBeNull();
  expect(seedBuys(10_000_000_000n, 0n, 0n)).toBeNull();
  expect(seedBuys(400_000_000n, 0n, 1_000_000_000n)!.every((b) => b >= MIN_SEED_BUY_LAMPORTS)).toBe(true);
});
test("the cap and loss limit come from settings; unset means no launches and no loss limit", () => {
  expect(maxBundleLamports({ LAUNCHSEEDS_MAX_BUNDLE_SOL: "0.5" })).toBe(500_000_000n);
  expect(maxBundleLamports({})).toBe(0n);
  expect(dailyLossLimit({ LAUNCHSEEDS_DAILY_LOSS_SOL: "0.3" })).toBe(300_000_000n);
  expect(dailyLossLimit({ LAUNCHSEEDS_DAILY_LOSS_SOL: "nope" })).toBe(0n);
});
test("one launch per wallet a day and a daily cap for everyone; failed launches count", () => {
  const now = 10 * 86_400_000, a = "A".repeat(44), b = "B".repeat(44);
  const token = (creatorWallet: string, ago: number, status = "live") => ({ creatorWallet, createdAt: now - ago, status }) as never;
  expect(seedLimit([], a, now, 20)).toBeNull();
  const five = [1, 2, 3, 4, 5].map((h) => token(a, h * 3_600_000));
  expect(seedLimit(five.slice(0, 4), a, now, 20)).toBeNull();
  expect(seedLimit(five, a, now, 20)).toContain("already launched 5 coins");
  expect(seedLimit([token(a, 25 * 3_600_000)], a, now, 20, 1)).toBeNull();
  expect(seedLimit([token(a, 3_600_000, "failed")], a, now, 20, 1)).toContain("already launched 1 coin");
  expect(seedLimit([token(b, 1), token(b, 2)], a, now, 2)).toContain("used up");
});
test("a launch holds the treasury until its bundle has sold and paid back", () => {
  const repo = (statuses: string[]) => ({ userBatches: { byToken: () => statuses.map((status) => ({ stateJson: JSON.stringify({ status }) })) } }) as never;
  const live = { id: 1, status: "live" } as never;
  expect(launchHoldsTreasury(repo([]), { id: 1, status: "funding" } as never)).toBe(true);
  expect(launchHoldsTreasury(repo(["holding"]), live)).toBe(false); // holding for its sell rule does not block
  expect(launchHoldsTreasury(repo(["buying", "holding"]), live)).toBe(true);
  expect(launchHoldsTreasury(repo(["settling"]), live)).toBe(true);
  expect(launchHoldsTreasury(repo(["exiting"]), live)).toBe(true);
  expect(launchHoldsTreasury(repo(["settled"]), live)).toBe(false);
  expect(launchHoldsTreasury(repo([]), { id: 1, status: "failed" } as never)).toBe(false);
});
test("the daily loss adds up each finished bundle's buys minus what its sale paid back", () => {
  const now = 10 * 86_400_000;
  const tokens = [{ id: 1, createdAt: now - 3_600_000 }, { id: 2, createdAt: now - 2 * 86_400_000 }];
  const runs: Record<number, object[]> = {
    1: [{ status: "settled", buyCostLamports: "500000000", paidLamports: "420000000" }, { status: "holding", buyCostLamports: "100" }],
    2: [{ status: "settled", buyCostLamports: "500000000", paidLamports: "0" }],
  };
  const repo = {
    tokens: { byFundingWalletName: (name: string) => (name === TREASURY_WALLET ? tokens : []) },
    userBatches: { byToken: (id: number) => runs[id]!.map((s) => ({ stateJson: JSON.stringify(s) })) },
  } as never;
  expect(dailyLoss(repo, now)).toBe(80_000_000n);
});
