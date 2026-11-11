import { expect, test } from "bun:test";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { CLAIM_MIN_LAMPORTS, tickFeeClaim, unclaimed, VAULT_RENT_LAMPORTS } from "../src/server/fee-claims";
import { treasuryOwed } from "../src/server/treasury";

test("the vault is claimed only once it holds enough above its rent", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    let claims = 0;
    const chain = (vault: bigint) => ({ vaultLamports: async () => vault, claim: async () => { claims++; return { signature: "sig", lamports: vault - VAULT_RENT_LAMPORTS }; } });
    expect(await tickFeeClaim(store.repo, chain(VAULT_RENT_LAMPORTS + CLAIM_MIN_LAMPORTS - 1n))).toBe("nothing to claim");
    expect(claims).toBe(0);
    expect(await tickFeeClaim(store.repo, chain(VAULT_RENT_LAMPORTS + CLAIM_MIN_LAMPORTS))).toContain("claimed");
    expect(claims).toBe(1);
    expect(store.repo.challenges.pendingClaim()).toBeNull();
  } finally {
    store.close();
  }
});

test("an unfinished claim resumes under the same id instead of starting another", async () => {
  const store = new Store(openLaunchseedsData(":memory:"));
  try {
    const ids: string[] = [];
    let fail = true;
    const chain = {
      vaultLamports: async () => 100_000_000n,
      claim: async (id: string) => { ids.push(id); if (fail) throw new Error("Claim abc is pending; will resume"); return { signature: "sig", lamports: 99_000_000n }; },
    };
    await expect(tickFeeClaim(store.repo, chain)).rejects.toThrow("will resume");
    fail = false;
    expect(await tickFeeClaim(store.repo, chain)).toContain("claimed 99000000");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]!);
  } finally {
    store.close();
  }
});

test("money owed to coins counts only what has reached the treasury", () => {
  expect(unclaimed(VAULT_RENT_LAMPORTS - 1n)).toBe(0n);
  expect(unclaimed(VAULT_RENT_LAMPORTS + 5n)).toBe(5n);
  expect(treasuryOwed(1_000n, 300n)).toBe(700n);
  expect(treasuryOwed(1_000n, 5_000n)).toBe(0n);
});
