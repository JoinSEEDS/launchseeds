import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LAUNCH_SETTINGS,
  UNSPECIFIED_LAUNCH_SETTINGS,
  canonicalLaunchSettings,
  parseLaunchSettings,
  storedLaunchSettings,
  feeSplit,
  activeLockUntil,
  takeoverEarliestAt,
  liquidityRange,
  rangeText,
  secondsText,
  elapsedText,
  sniperDescription,
  durationText,
  humanRemaining,
  SNIPER_SECONDS,
  MARKET_CAP_STOPS,
} from "../src/domain/launch-settings";
import { nextLeadershipState, leadingStrategy } from "../src/domain/governance";
import { bundleWalletName } from "../src/server/launch-bundle";

const day = 86_400_000;
const hour = 3_600_000;
const threeMinutes = 180_000;
const launchedAt = 1_800_000_000_000;

function policy(patch: Partial<Parameters<typeof takeoverEarliestAt>[1]> = {}) {
  return {
    initialStrategyId: 1,
    launchedAt,
    activatedAt: launchedAt,
    firstLockMs: day,
    minimumActiveMs: hour,
    ...patch,
  };
}
function contest(start = launchedAt + 12_000) {
  return {
    activeStrategyId: 1,
    leaderStrategyId: 2,
    leaderSince: start,
  };
}

test("scheduled buyer wallet names are fresh per coin and stable across retries", () => {
  const firstMint = "A".repeat(32);
  const secondMint = "B".repeat(32);
  expect(bundleWalletName(firstMint, 0)).not.toBe(bundleWalletName(secondMint, 0));
  expect(bundleWalletName(firstMint, 0)).toBe(bundleWalletName(firstMint, 0));
  expect(bundleWalletName(firstMint, 0)).not.toBe(bundleWalletName(firstMint, 1));
});

describe("launch policy storage", () => {
  test("defaults are exact, immutable choices", () => {
    // Designer v5 defaults: 24h lock, 1h minimum, 30s puzzle; liquidity off until it exists.
    expect(DEFAULT_LAUNCH_SETTINGS).toEqual({
      publishMint: false,
      publishProject: false,
      userBatches: null,
  boost: null,
  scheduledAt: null,
      walletSharesBps: null,
      profitPolicy: null,
      firstStrategyLockMs: day,
      minimumActiveMs: hour,
      sniperSeconds: 30,
      liquidity: null,
      holderRewards: false,
      sellPlan: [],
      bundleLamports: null,
      bundleExitPercent: 102,
      bundleMaxHoldMs: null,
      feesTo: null,
    });
    expect(Object.isFrozen(DEFAULT_LAUNCH_SETTINGS)).toBe(true);
    // Launches stored before holder rewards existed read as ordinary launches.
    expect(
      parseLaunchSettings({
        firstStrategyLockMs: day,
        minimumActiveMs: hour,
        sniperSeconds: 30,
        liquidity: null,
      }).holderRewards,
    ).toBe(false);
    expect(parseLaunchSettings(DEFAULT_LAUNCH_SETTINGS)).toEqual(
      DEFAULT_LAUNCH_SETTINGS,
    );
  });

  test("persisted JSON round-trips without silent coercion", () => {
    const json = canonicalLaunchSettings(DEFAULT_LAUNCH_SETTINGS);
    expect(storedLaunchSettings(json)).toEqual(DEFAULT_LAUNCH_SETTINGS);
    expect(() =>
      parseLaunchSettings({
        ...DEFAULT_LAUNCH_SETTINGS,
        privateKey: "do not accept",
      }),
    ).toThrow();
    expect(() =>
      parseLaunchSettings({
        ...DEFAULT_LAUNCH_SETTINGS,
        minimumActiveMs: "3600000",
      }),
    ).toThrow();
    expect(() => storedLaunchSettings("{unfinished")).toThrow(
      "Operator review",
    );
  });

  test("older tokens without immutable settings retain their previous governance rule", () => {
    expect(storedLaunchSettings("")).toEqual(UNSPECIFIED_LAUNCH_SETTINGS);
    expect(UNSPECIFIED_LAUNCH_SETTINGS.firstStrategyLockMs).toBe(0);
    expect(UNSPECIFIED_LAUNCH_SETTINGS.minimumActiveMs).toBe(threeMinutes);
    expect(UNSPECIFIED_LAUNCH_SETTINGS.sniperSeconds).toBeNull();
    expect(UNSPECIFIED_LAUNCH_SETTINGS.liquidity).toBeNull();
  });

  test("liquidity ranges come from the slider stops and must start below their end", () => {
    for (const [minMcapUsd, maxMcapUsd] of [
      [100_000, 100_000],
      [1_000_000, 100_000],
      [-1, 100_000],
      [150_000, 1_000_000],
    ]) {
      expect(() =>
        parseLaunchSettings({
          ...DEFAULT_LAUNCH_SETTINGS,
          liquidity: { feeShare: 25, minMcapUsd, maxMcapUsd },
        }),
      ).toThrow();
    }
    const good = parseLaunchSettings({
      ...DEFAULT_LAUNCH_SETTINGS,
      liquidity: { feeShare: 25, minMcapUsd: 10_000, maxMcapUsd: 100_000_000 },
    });
    expect(liquidityRange(good)).toEqual({
      lowerUsd: 10_000,
      upperUsd: 100_000_000,
    });
    expect(rangeText(good)).toBe("$10K–$100M");
    expect(
      liquidityRange({ ...DEFAULT_LAUNCH_SETTINGS, liquidity: null }),
    ).toBeNull();
  });

  test("rejects unsupported choices, huge numbers and malformed allocation", () => {
    for (const [key, value] of [
      ["firstStrategyLockMs", -1],
      ["firstStrategyLockMs", 9_999_999],
      ["minimumActiveMs", 30_000],
      ["sniperSeconds", 7],
      ["sniperSeconds", 0],
      ["sniperSeconds", "30"],
      [
        "liquidity",
        { feeShare: 0, minMcapUsd: 100_000, maxMcapUsd: 1_000_000 },
      ],
      [
        "liquidity",
        { feeShare: 51, minMcapUsd: 100_000, maxMcapUsd: 1_000_000 },
      ],
      [
        "liquidity",
        { feeShare: 2.5, minMcapUsd: 100_000, maxMcapUsd: 1_000_000 },
      ],
      [
        "liquidity",
        { feeShare: 25, minMcapUsd: 100_000, maxMcapUsd: Infinity },
      ],
      ["sniperDifficulty", "medium"],
    ] as const) {
      expect(() =>
        parseLaunchSettings({ ...DEFAULT_LAUNCH_SETTINGS, [key]: value }),
      ).toThrow();
    }
    // Every slider stop is accepted.
    for (const sniperSeconds of SNIPER_SECONDS)
      expect(
        parseLaunchSettings({ ...DEFAULT_LAUNCH_SETTINGS, sniperSeconds })
          .sniperSeconds,
      ).toBe(sniperSeconds);
    expect(MARKET_CAP_STOPS[0]).toBe(10_000);
    expect(MARKET_CAP_STOPS.at(-1)).toBe(100_000_000);
  });
});

describe("governance locks and three-minute contender rule", () => {
  test("a challenger can lead during the first-strategy lock without taking over", () => {
    const start = launchedAt + hour;
    const previous = contest(start);
    const actual = nextLeadershipState(
      previous,
      2,
      start + threeMinutes + 1,
      policy(),
    );
    expect(actual.activeStrategyId).toBe(1);
    expect(actual.leaderSince).toBe(start);
    expect(takeoverEarliestAt(actual, policy())).toBe(launchedAt + day);
  });

  test("when lock ends, a long-standing leader takes over immediately", () => {
    const current = contest(launchedAt + 30 * 60_000);
    const result = nextLeadershipState(current, 2, launchedAt + day, policy());
    expect(result.activeStrategyId).toBe(2);
    expect(result.leaderSince).toBeNull();
  });

  test("a new leader at lock expiry must still wait three minutes", () => {
    const almost = nextLeadershipState(
      contest(launchedAt + day - 30_000),
      2,
      launchedAt + day,
      policy(),
    );
    expect(almost.activeStrategyId).toBe(1);
    expect(
      nextLeadershipState(almost, 2, launchedAt + day + 150_000, policy())
        .activeStrategyId,
    ).toBe(2);
  });

  test("minimum active time applies after every takeover, not only first strategy", () => {
    const state = {
      activeStrategyId: 3,
      leaderStrategyId: 2,
      leaderSince: launchedAt + 10 * 60_000,
    };
    const updatedPolicy = policy({
      activatedAt: launchedAt + 9 * 60_000,
      firstLockMs: day,
    });
    expect(takeoverEarliestAt(state, updatedPolicy)).toBe(
      launchedAt + 9 * 60_000 + hour,
    );
    expect(
      nextLeadershipState(state, 2, launchedAt + 25 * 60_000, updatedPolicy)
        .activeStrategyId,
    ).toBe(3);
    expect(
      nextLeadershipState(state, 2, launchedAt + 69 * 60_000, updatedPolicy)
        .activeStrategyId,
    ).toBe(2);
  });

  test("leader changes reset the required hold period", () => {
    const first = contest(launchedAt + day - 60_000);
    const second = nextLeadershipState(
      first,
      4,
      launchedAt + day - 30_000,
      policy(),
    );
    expect(second.leaderStrategyId).toBe(4);
    expect(second.leaderSince).toBe(launchedAt + day - 30_000);
    expect(
      nextLeadershipState(second, 4, launchedAt + day, policy())
        .activeStrategyId,
    ).toBe(1);
  });

  test("ties or disappearance clear the leader, they do not prematurely transfer", () => {
    expect(
      nextLeadershipState(contest(), null, launchedAt + day + hour, policy()),
    ).toEqual({
      activeStrategyId: 1,
      leaderStrategyId: null,
      leaderSince: null,
    });
    expect(
      leadingStrategy(
        [
          { strategyId: 2, gravityMicros: 20n, voters: 1 },
          { strategyId: 3, gravityMicros: 20n, voters: 1 },
        ],
        1,
      ),
    ).toBeNull();
  });

  test("active first strategy remains locked even when nobody has voted", () => {
    expect(activeLockUntil({ activeStrategyId: 1 }, policy())).toBe(
      launchedAt + day,
    );
    expect(activeLockUntil({ activeStrategyId: 3 }, policy())).toBe(
      launchedAt + hour,
    );
    expect(
      takeoverEarliestAt(
        { activeStrategyId: 1, leaderStrategyId: null, leaderSince: null },
        policy(),
      ),
    ).toBeNull();
  });

  test("no-lock minimum remains the configured active time", () => {
    const unrestricted = policy({
      firstLockMs: 0,
      minimumActiveMs: threeMinutes,
    });
    const state = contest(launchedAt);
    expect(
      nextLeadershipState(state, 2, launchedAt + threeMinutes, unrestricted)
        .activeStrategyId,
    ).toBe(2);
  });
});

describe("fee allocation, liquidity range and enforcement", () => {
  test("$TOKEN is always deducted first and remainder goes to holders", () => {
    for (const lp of [0, 1, 10, 25, 37, 50]) {
      const split = feeSplit(lp, 100);
      expect(split.tokenCents).toBe(10);
      expect(split.liquidityCents).toBe(lp);
      expect(split.rewardsCents).toBe(90 - lp);
      expect(split.tokenCents + split.liquidityCents + split.rewardsCents).toBe(
        100,
      );
    }
  });
  test("fixed-point cents never allocate more than collected", () => {
    for (let cents = 0; cents < 200; cents++) {
      const split = feeSplit(50, cents);
      expect(split.tokenCents + split.liquidityCents + split.rewardsCents).toBe(
        cents,
      );
      expect(split.rewardsCents).toBeGreaterThanOrEqual(0);
    }
    expect(() => feeSplit(51)).toThrow();
    expect(() => feeSplit(2.5)).toThrow();
    expect(() => feeSplit(25, -1)).toThrow();
  });
  test("creators may choose sniper protection and liquidity before the executors exist", () => {
    expect(parseLaunchSettings(DEFAULT_LAUNCH_SETTINGS).sniperSeconds).toBe(30);
    expect(
      parseLaunchSettings({
        ...DEFAULT_LAUNCH_SETTINGS,
        sniperSeconds: null,
        liquidity: null,
      }),
    ).toEqual({
      publishMint: false,
      publishProject: false,
      userBatches: null,
  boost: null,
  scheduledAt: null,
      walletSharesBps: null,
      profitPolicy: null,
      firstStrategyLockMs: day,
      minimumActiveMs: hour,
      sniperSeconds: null,
      liquidity: null,
      holderRewards: false,
      sellPlan: [],
      bundleLamports: null,
      bundleExitPercent: 102,
      bundleMaxHoldMs: null,
      feesTo: null,
    });
  });
  test("human-facing names are deterministic", () => {
    expect(sniperDescription(DEFAULT_LAUNCH_SETTINGS)).toBe("30s puzzle");
    expect(
      sniperDescription({ ...DEFAULT_LAUNCH_SETTINGS, sniperSeconds: null }),
    ).toBe("Off");
    expect(secondsText(1)).toBe("1s");
    expect(secondsText(90)).toBe("90s");
    expect(secondsText(300)).toBe("5 min");
    expect(elapsedText(41 * 60_000)).toBe("41m");
    expect(elapsedText((3 * 60 + 12) * 60_000)).toBe("3h 12m");
    expect(elapsedText((2 * 24 + 9) * 3_600_000)).toBe("2d 9h");
    expect(durationText(604800000)).toBe("7d");
    expect(humanRemaining(42 * 60_000)).toBe("Can change in 42m");
  });
});
