import { describe, expect, test } from "bun:test";
import { poolWallets, reuseWalletPool } from "../src/server/wallet-pool";

describe("reuseWalletPool", () => {
  test("empty or unset means fresh-wallet mode", () => {
    expect(reuseWalletPool({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      reuseWalletPool({ LAUNCHSEEDS_REUSE_WALLETS: "" } as NodeJS.ProcessEnv),
    ).toEqual([]);
    expect(
      reuseWalletPool({ LAUNCHSEEDS_REUSE_WALLETS: "  " } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });
  test("splits and trims the configured names", () => {
    expect(
      reuseWalletPool({
        LAUNCHSEEDS_REUSE_WALLETS: "art, bet,sun , ace,cat",
      } as NodeJS.ProcessEnv),
    ).toEqual(["art", "bet", "sun", "ace", "cat"]);
  });
  test("rejects duplicate names", () => {
    expect(() =>
      reuseWalletPool({
        LAUNCHSEEDS_REUSE_WALLETS: "art,bet,art",
      } as NodeJS.ProcessEnv),
    ).toThrow(/duplicate/);
  });
});

describe("poolWallets", () => {
  const pool = ["art", "bet", "sun", "ace", "cat"];
  test("picks distinct wallets", () => {
    const picked = poolWallets("SomeMint111", pool, 3);
    expect(new Set(picked).size).toBe(3);
    for (const wallet of picked) expect(pool).toContain(wallet);
  });
  test("is deterministic per seed and agrees across call sites", () => {
    expect(poolWallets("MintA", pool, 3)).toEqual(poolWallets("MintA", pool, 3));
    expect(poolWallets("MintA", pool, 3)).not.toEqual(
      poolWallets("MintB", pool, 3),
    );
  });
  test("excludes given wallets and starts at an offset", () => {
    const buyers = poolWallets("MintC", pool, 3);
    const funding = poolWallets("MintC", pool, 1, {
      exclude: buyers,
      startOffset: 3,
    });
    expect(funding).toHaveLength(1);
    expect(buyers).not.toContain(funding[0]);
  });
  test("rotates different mints across the pool over many seeds", () => {
    const uses = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      const w = poolWallets(`mint-${i}`, pool, 1)[0]!;
      uses.set(w, (uses.get(w) ?? 0) + 1);
    }
    // Rotation spreads seeds over the pool instead of pinning one wallet.
    expect(Math.min(...uses.values())).toBeGreaterThan(2);
  });
  test("fails loudly when the pool cannot satisfy the request", () => {
    expect(() => poolWallets("mint", ["solo"], 3)).toThrow(/too small/);
    expect(() =>
      poolWallets("mint", ["a", "b"], 1, { exclude: ["a", "b"] }),
    ).toThrow(/too small/);
  });
});
