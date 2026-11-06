import { expect, test } from "bun:test";
import { TICKER_PATTERN, normalizeTicker } from "../lib/ticker";
import { validateLaunchFields } from "../lib/launch-ui";
import { launchInput } from "../src/shared/domain";

test("separators are allowed between letters and digits, up to 13 characters", () => {
  for (const ok of ["d/acc", "D/ACC", "e.g", "a-b_c", "A", "ABCDEFGHIJ", "MixedCase", "ABCDEFGHIJKLM"]) expect(TICKER_PATTERN.test(ok)).toBe(true);
  for (const bad of ["/acc", "d/", "d acc", "<b>", "ABCDEFGHIJKLMN", "", "d/acc\n"]) expect(TICKER_PATTERN.test(bad)).toBe(false);
});
test("a lowercase ticker is uppercased and any other keeps its case", () => {
  expect(normalizeTicker("fair")).toBe("FAIR");
  expect(normalizeTicker("MixedCase")).toBe("MixedCase");
  expect(normalizeTicker("d/acc")).toBe("d/acc");
});
test("the form and the server take d/acc as typed", () => {
  expect(String(validateLaunchFields({ name: "d/acc", symbol: "d/acc", devBuySol: "0", website: "", x: "", telegram: "", description: "", settings: { scheduledAt: 1 } } as never))).not.toContain("ticker");
  const parsed = launchInput.shape.symbol.parse("d/acc");
  expect(parsed).toBe("d/acc");
});
