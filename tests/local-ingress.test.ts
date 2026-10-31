import { expect, test } from "bun:test";
import { localIngress } from "../src/server/local-ingress";
import { trustedClientKey } from "../lib/trusted-client";
test("local ingress accepts only loopback peers and ignores browser identity headers", async () => {
  const request = new Request("http://localhost:3010/api/test", {
    method: "POST",
    headers: {
      origin: "http://localhost:3010",
      "x-launchseeds-edge-client": "forged-client",
    },
    body: "payload",
  });
  const trusted = localIngress(request, "127.0.0.1");
  expect(trustedClientKey(trusted, { production: true })).toBe(
    "local-loopback",
  );
  expect(await trusted.text()).toBe("payload");
  expect(trusted.headers.get("origin")).toBe("http://localhost:3010");
  expect(() =>
    localIngress(new Request("http://localhost:3010"), "203.0.113.1"),
  ).toThrow();
  expect(() =>
    localIngress(new Request("http://localhost:3010"), null),
  ).toThrow();
});
test("visitors behind Caddy reverse_proxy get separate rate-limit identities", () => {
  const key = (xff: string) =>
    trustedClientKey(
      localIngress(
        new Request("http://localhost:3010/api/test", {
          headers: { "x-forwarded-for": xff },
        }),
        "127.0.0.1",
      ),
      { production: true },
    );
  expect(key("198.51.100.7")).not.toBe(key("203.0.113.9"));
  expect(key("198.51.100.7")).toStartWith("ip:");
  expect(key("198.51.100.7")).not.toContain("198.51");
  // A visitor-forged left entry does not change the identity Caddy appended.
  expect(key("10.0.0.1, 198.51.100.7")).toBe(key("198.51.100.7"));
});
