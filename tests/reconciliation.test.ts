import { expect, test } from "bun:test";
import { discoverRoutes } from "tradjs/server";
import { Database as SqliteFixture } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { openDatabase as createDatabase } from "../src/db/connection";

test("one canonical route pattern exists for each page and API", () => {
  const routes = discoverRoutes("./app");
  const identities = routes.map(
    (route) => `${route.type}:${route.pattern.replace(/:[^/]+/g, ":param")}`,
  );
  expect(new Set(identities).size).toBe(routes.length);
  const paths = routes.map((route) => route.pattern);
  expect(paths).toContain("/admin");
  expect(paths).toContain("/api/seeds");
  for (const retired of ["/api/launch", "/api/launches", "/api/launch-payment", "/api/odds"])
    expect(paths).not.toContain(retired);
});
test("incompatible database layout is rejected before migrations without changing disk data", () => {
  mkdirSync(".docs/verification", { recursive: true });
  const path = `.docs/verification/incompatible-${crypto.randomUUID()}.sqlite`;
  const fixture = new SqliteFixture(path);
  fixture.exec(
    "CREATE TABLE tokens (id TEXT PRIMARY KEY, nonsense TEXT, status TEXT); INSERT INTO tokens VALUES ('item-one','anything','idle')",
  );
  fixture.close();
  const before = readFileSync(path);
  expect(() => createDatabase(path)).toThrow(
    "Incompatible LaunchSeeds database schema",
  );
  expect(readFileSync(path)).toEqual(before);
  const inspect = new SqliteFixture(path, { readonly: true });
  try {
    expect(inspect.query("SELECT id FROM tokens").get()).toEqual({
      id: "item-one",
    });
  } finally {
    inspect.close();
  }
});

test("an obsolete required token field cannot bypass schema compatibility checks", () => {
  mkdirSync(".docs/verification", { recursive: true });
  const path = `.docs/verification/incompatible-token-${crypto.randomUUID()}.sqlite`;
  const fixture = new SqliteFixture(path);
  try {
    fixture.exec(
      "CREATE TABLE tokens (id INTEGER PRIMARY KEY, uid TEXT, symbol TEXT, extraRequired TEXT NOT NULL)",
    );
  } finally {
    fixture.close();
  }
  const before = readFileSync(path);
  expect(() => createDatabase(path)).toThrow(
    "Incompatible LaunchSeeds database schema",
  );
  expect(readFileSync(path)).toEqual(before);
});
