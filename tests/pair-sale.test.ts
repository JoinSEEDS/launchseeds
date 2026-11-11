import { expect, test } from "bun:test";
import { pairedBuyMinimums } from "../src/server/pair-launch";
import { pairedSaleMinimum } from "../src/server/pair-sale";
import { PUMP_INITIAL_VIRTUAL_BASE } from "../src/domain/user-funded-batches";

// $SEEDS's curve after its launch (~34 SOL in), and a fresh coin quoted in $SEEDS.
const pair = { virtualSol: 34_000_000_000n, virtualToken: 946_000_000_000_000n };
const SUPPLY = 1_000_000_000_000_000n;
const fresh = { initialVirtualQuote: 238_413_379_813_159n, initialVirtualBase: PUMP_INITIAL_VIRTUAL_BASE };

test("paired buy minimums walk both curves in bundle order, each later wallet getting fewer coins", () => {
  const mins = pairedBuyMinimums({ pairCurve: pair, ...fresh }, [100_000_000n, 100_000_000n, 100_000_000n]);
  expect(mins[0]! > mins[1]! && mins[1]! > mins[2]!).toBe(true);
  expect(mins[0]! > 0n).toBe(true);
});

test("a paired sale returns SOL through the pair coin; floors hold in the pair coin's units", () => {
  // The coin after a 0.4 SOL bundle bought through $SEEDS.
  const [bought] = pairedBuyMinimums({ pairCurve: pair, ...fresh }, [400_000_000n]).map((m) => m * 2n);
  const k = fresh.initialVirtualQuote * fresh.initialVirtualBase, base = fresh.initialVirtualBase - bought!, coin = { virtualBase: base, virtualQuote: k / base, supply: SUPPLY };
  const sellRaw = bought! / 4n;
  const market = pairedSaleMinimum({ coin, pair, sellRaw, requiredLamports: null })!;
  expect(market > 0n && market < 400_000_000n).toBe(true);
  // A profit target above the market quote becomes the minimum.
  expect(pairedSaleMinimum({ coin, pair, sellRaw, requiredLamports: 900_000_000n })).toBe(900_000_000n);
  // Right after the bundle, any sale would take the market cap below where the bundle
  // left it: the minimum is more SOL than the sale can return, so it fails and holds.
  expect(pairedSaleMinimum({ coin, pair, sellRaw, requiredLamports: null, afterBundleRaw: bought! })! > market * 10n / 9n).toBe(true);
  // After outside buyers lift the curve, the same sale clears the floor: its minimum is
  // within what it returns.
  const lifted = { ...coin, virtualBase: base - bought!, virtualQuote: k / (base - bought!) };
  const liftedMarket = pairedSaleMinimum({ coin: lifted, pair, sellRaw, requiredLamports: null })!;
  expect(pairedSaleMinimum({ coin: lifted, pair, sellRaw, requiredLamports: null, afterBundleRaw: bought! })! <= liftedMarket * 10n / 9n).toBe(true);
  // A USD floor far above the market cap asks more than the sale can return.
  expect(pairedSaleMinimum({ coin, pair, sellRaw, requiredLamports: null, floorUsd: 1_000_000, solUsd: 84 }) ?? 10n ** 30n).toBeGreaterThan(market * 10n / 9n);
});
