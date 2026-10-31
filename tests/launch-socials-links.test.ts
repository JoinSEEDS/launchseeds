import { test, expect } from "bun:test";
import { telegramLink, xLink } from "../lib/launch-socials";

test("metadata socials are full URLs", () => {
  expect(xLink("funlaunchseeds")).toBe("https://x.com/funlaunchseeds");
  expect(xLink("@funlaunchseeds")).toBe("https://x.com/funlaunchseeds");
  expect(xLink("")).toBe("");
  expect(telegramLink("launchseedschat")).toBe("https://t.me/launchseedschat");
  expect(telegramLink("t.me/launchseedschat")).toBe("https://t.me/launchseedschat");
  expect(telegramLink("https://telegram.me/launchseedschat")).toBe("https://t.me/launchseedschat");
  expect(telegramLink("")).toBe("");
});
