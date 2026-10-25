import { describe, expect, test } from "bun:test";
import {
  buildLaunchPayload,
  formatLamports,
  launchTotal,
  launchUrl,
  launchView,
  parseSol,
  publicTokenUrl,
  safeLamports,
  validateImage,
  validateLaunchFields,
  validLaunchStatus,
  type LaunchFormFields,
  type PublicLaunchStatus,
} from "../lib/launch-ui";
import { DEFAULT_LAUNCH_SETTINGS } from "../src/domain/launch-settings";
import { DESCRIPTION } from "../lib/strategy";

const fields: LaunchFormFields = {
  name: "  Launchseeds  ",
  symbol: "fair",
  devBuySol: "0.5",
  website: "https://launchseeds.xyz",
  x: "@launchseeds",
  telegram: "@launchseeds",
  image: "https://launchseeds.xyz/example.png",
  firstStrategy: { type: "burn", amount: 25 },
  settings: DEFAULT_LAUNCH_SETTINGS,
};
const baseline: PublicLaunchStatus = {
  handle: "0123456789abcdef0123456789abcdef",
  status: "funding",
  name: "Launchseeds",
  symbol: "FAIR",
  fundingWallet: "1".repeat(32),
  requiredLamports: 520_000_000,
  receivedLamports: 200_000_000,
  mint: "",
  launchSignature: "",
  error: "",
};

describe("launch field preparation", () => {
  test("locks the exact description during submission", () => {
    const payload = buildLaunchPayload(fields);
    expect(payload.description).toBe(DESCRIPTION);
    expect(payload.symbol).toBe("FAIR");
    expect(payload.name).toBe("Launchseeds");
    expect(payload.firstStrategy).toEqual({ type: "burn", amount: 25 });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "name",
        "symbol",
        "description",
        "image",
        "website",
        "x",
        "telegram",
        "devBuySol",
        "firstStrategy",
        "settings",
      ].sort(),
    );
  });

  test("accepts valid launch fields", () => {
    expect(validateLaunchFields(fields)).toBeNull();
  });

  test("social fields are optional and accept pasted links", async () => {
    const { launchInput } = await import("../src/shared/domain");
    for (const telegram of ["", "   ", " @launchseeds ", "https://t.me/launchseeds/", "https://t.me/+Abc_123-xyz", "https://t.me/joinchat/Abc123", "https://telegram.me/launchseeds"]) {
      const input = { ...fields, website: "   ", x: " https://x.com/launchseeds ", telegram };
      expect(validateLaunchFields(input)).toBeNull();
      const parsed = launchInput.parse(buildLaunchPayload(input));
      expect(parsed.website).toBe("");
      expect(parsed.x).toBe("launchseeds");
    }
    expect(launchInput.parse(buildLaunchPayload({ ...fields, website: "", x: "", telegram: "" })).telegram).toBe("");
  });

  test("rejects invalid tickers, URLs, usernames, and dev buy precision", () => {
    expect(validateLaunchFields({ ...fields, symbol: "$fair" })).toContain(
      "ticker",
    );
    expect(validateLaunchFields({ ...fields, name: "" })).toContain("name");
    expect(
      validateLaunchFields({ ...fields, website: "http://example.org" }),
    ).toContain("https");
    expect(
      validateLaunchFields({ ...fields, x: "invalid username" }),
    ).toContain("X handle");
    expect(validateLaunchFields({ ...fields, telegram: "!bad" })).toContain(
      "Telegram",
    );
    expect(
      validateLaunchFields({ ...fields, devBuySol: "1.0000000001" }),
    ).toContain("initial reward fund");
  });

  test("uses integer lamports for quotes without floating point rounding", () => {
    expect(parseSol("0.000000001")).toBe(1n);
    expect(parseSol("1.2")).toBe(1_200_000_000n);
    expect(parseSol("1.0000000001")).toBeNull();
    expect(parseSol("abc")).toBeNull();
    expect(launchTotal("0.1", 20_000_000)).toBe("0.12");
    expect(launchTotal("0.000000001", 20_000_000)).toBe("0.020000001");
  });

  test("handles untrusted or out-of-range numeric inputs", () => {
    expect(safeLamports(-1)).toBe(0);
    expect(safeLamports(Number.POSITIVE_INFINITY)).toBe(0);
    expect(formatLamports(500_000_000)).toBe("0.5");
    expect(formatLamports(1_000_000_001)).toBe("1.000000001");
    expect(launchTotal("100000000000000", 20_000_000)).toBeNull();
  });

  test("only exposes well-shaped public launch URLs", () => {
    const uid = baseline.handle;
    expect(launchUrl(uid)).toBe(`/launch?launch=${uid}`);
    // Launches created before 2026-10-25 keep their id-shaped handle.
    expect(launchUrl("550e8400-e29b-41d4-a716-446655440000")).toBe("/launch?launch=550e8400-e29b-41d4-a716-446655440000");
    const mint = "HchTYRATYXki7CAKkyRGMqMuKejgVxit6YYzwMfZBmtM";
    expect(publicTokenUrl(mint)).toBe(`/token/${mint}`);
    expect(publicTokenUrl(uid)).toBeNull();
    expect(launchUrl("../../api/launches")).toBeNull();
    expect(publicTokenUrl("garbage")).toBeNull();
  });
});

describe("launch status presentation", () => {
  test("shows confirmed funding address only while funding", () => {
    const view = launchView(baseline);
    expect(view.canFund).toBe(true);
    expect(view.showAddress).toBe(true);
    expect(view.requiredSol).toBe("0.52");
    expect(view.receivedSol).toBe("0.2");
    expect(view.progress).toBeGreaterThan(38);
    expect(view.progress).toBeLessThan(39);
  });

  test("rejects structurally invalid public launch records", () => {
    expect(validLaunchStatus(baseline)).toBe(true);
    expect(validLaunchStatus({ ...baseline, status: "unexpected" })).toBe(
      false,
    );
    expect(validLaunchStatus({ ...baseline, receivedLamports: "20" })).toBe(
      false,
    );
    expect(validLaunchStatus({ ...baseline, handle: "../../token" })).toBe(false);
  });

  test("hides funding address while preparing", () => {
    const view = launchView({ ...baseline, status: "preparing" });
    expect(view.showAddress).toBe(false);
    expect(view.message).toContain("Do not send");
  });

  test("never invites deposit into a missing or invalid funding wallet", () => {
    const view = launchView({ ...baseline, fundingWallet: "not-an-address" });
    expect(view.canFund).toBe(false);
    expect(view.showAddress).toBe(false);
    expect(view.message).toContain("Do not send");
  });

  test("hides funding address when deployment begins", () => {
    const view = launchView({ ...baseline, status: "deploying" });
    expect(view.canFund).toBe(false);
    expect(view.waiting).toBe(true);
  });

  test("offers the token page only after a live mint is recorded", () => {
    const pending = launchView({ ...baseline, status: "live", mint: "" });
    const live = launchView({
      ...baseline,
      status: "live",
      mint: "1".repeat(32),
    });
    expect(pending.showTokenLink).toBe(false);
    expect(live.showTokenLink).toBe(true);
    expect(live.isComplete).toBe(true);
  });

  test("never offers deposit on failed operations", () => {
    const failed = launchView({
      ...baseline,
      status: "failed",
      error: "Operator attention",
    });
    expect(failed.isComplete).toBe(true);
    expect(failed.canFund).toBe(false);
    expect(failed.message).toContain("Operator attention");
  });
});

describe("image submission", () => {
  test("requires an actual image", () => {
    expect(validateImage(null)).toContain("Choose");
    expect(
      validateImage(new File(["code"], "x.js", { type: "text/javascript" })),
    ).toContain("PNG");
  });

  test("rejects empty and oversized image uploads", () => {
    expect(
      validateImage(new File([], "empty.png", { type: "image/png" })),
    ).toContain("empty");
    expect(
      validateImage(
        new File([new Uint8Array(5_000_001)], "huge.png", { type: "image/png" }),
      ),
    ).toContain("5 MB");
  });

  test("accepts images above the old cap through exactly 5 MB", () => {
    for (const size of [550_001, 5_000_000]) {
      expect(validateImage(new File([new Uint8Array(size)], "token.png", {type:"image/png"}))).toBeNull();
    }
  });

  test("allows a valid small PNG", () => {
    expect(
      validateImage(
        new File([new Uint8Array(10)], "small.png", { type: "image/png" }),
      ),
    ).toBeNull();
  });
});
