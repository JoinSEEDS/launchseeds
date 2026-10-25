import { Database } from "sqlite-zod-orm";
import { Database as Inspector } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { schemas as businessSchemas } from "./schema";
import { runtimeSchemas } from "./runtime-schema";
const schemas = { ...businessSchemas, ...runtimeSchemas };
import { INDEXES } from "./indexes";

export function openDatabase(path = "./data/launchseeds-v3.sqlite") {
  // Inspect before the ORM can rebuild an incompatible legacy table.
  if (path !== ":memory:" && existsSync(path)) {
    const source = new Inspector(path, { readonly: true });
    try {
      for (const [table, schema] of Object.entries(schemas)) {
        const cols = source.query(`PRAGMA table_info("${table}")`).all() as {
          name: string;
          type: string;
          pk: number;
          notnull: number;
          dflt_value: unknown;
        }[];
        if (!cols.length) continue;
        const names = new Set(cols.map((x) => x.name));
        const identity = cols.find((x) => x.name === "id");
        const known = new Set(["id", ...Object.keys(schema.shape)]);
        if (
          identity?.type !== "INTEGER" ||
          identity.pk !== 1 ||
          Object.entries(schema.shape).some(([key, field]) => !names.has(key) && !field.safeParse(undefined).success) ||
          cols.some(
            (x) => !known.has(x.name) && x.notnull && x.dflt_value == null,
          )
        )
          throw new Error(
            `Incompatible LaunchSeeds database schema (${table}). Existing data was not changed. Migrate explicitly to a separate LAUNCHSEEDS_DB_PATH.`,
          );
      }
    } finally {
      source.close();
    }
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, schemas, {
    busyTimeout: 10_000,
    reactive: false,
  });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    for (const sql of INDEXES) db.exec(sql);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export type LaunchseedsDatabase = ReturnType<typeof openDatabase>;
