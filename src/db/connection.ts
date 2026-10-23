import { Database } from "sqlite-zod-orm";
import { schemas } from "./schema";
import { INDEXES } from "./indexes";

export function openDatabase(path = "./data/launchseeds.sqlite") {
  const db = new Database(path, schemas, { busyTimeout: 10_000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of INDEXES) db.exec(sql);
  return db;
}

export type LaunchseedsDatabase = ReturnType<typeof openDatabase>;
