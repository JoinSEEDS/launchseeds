import type { LaunchseedsDatabase } from "../connection";
import { schemas, type Tables } from "../schema";

export type SqlDb = LaunchseedsDatabase;
export type PageArgs = { limit: number; offset?: number };
export type Page<T> = { items: T[]; nextOffset: number | null };
export const safePage = ({ limit, offset = 0 }: PageArgs) => ({
  limit: Math.max(1, Math.min(100, Math.floor(limit))),
  offset: Math.max(0, Math.floor(offset)),
});

export function rows<T>(
  db: SqlDb,
  sql: string,
  ...args: Array<string | number | null>
): T[] {
  return db.raw<T>(sql, ...args) as unknown as T[];
}
export function one<T>(
  db: SqlDb,
  sql: string,
  ...args: Array<string | number | null>
): T | null {
  return rows<T>(db, sql, ...args)[0] ?? null;
}
export function change(
  db: SqlDb,
  sql: string,
  ...args: Array<string | number | null>
): boolean {
  // RETURNING is supported in SQLite 3.35+ and eliminates reliance on exec() return values.
  return rows<{ uid: string }>(db, `${sql} RETURNING uid`, ...args).length > 0;
}
export function page<T>(items: T[], pageArgs: PageArgs): Page<T> {
  const p = safePage(pageArgs);
  return {
    items: items.slice(0, p.limit),
    nextOffset: items.length > p.limit ? p.offset + p.limit : null,
  };
}
export function selectPage<T>(
  db: SqlDb,
  sql: string,
  params: Array<string | number | null>,
  pg: PageArgs,
): Page<T> {
  const p = safePage(pg);
  const items = rows<T>(
    db,
    `${sql} LIMIT ? OFFSET ?`,
    ...params,
    p.limit + 1,
    p.offset,
  );
  return page(items, p);
}
export function nonnegativeString(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("Invalid nonnegative atomic amount");
  return BigInt(value);
}
export function validIdentifier(s: string) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)) throw new Error("Invalid identifier");
  return s;
}
export function patchByUid<T extends Record<string, unknown>>(
  db: SqlDb,
  table: string,
  uid: string,
  patch: Partial<T>,
  whitelist: readonly string[],
): boolean {
  const entries = Object.entries(patch).filter(
    ([k, v]) => v !== undefined && whitelist.includes(k),
  );
  if (!entries.length) return false;
  if (
    entries.length !==
    Object.entries(patch).filter(([, v]) => v !== undefined).length
  )
    throw new Error("Forbidden patch field");
  const col = entries.map(([k]) => `${validIdentifier(k)} = ?`).join(", ");
  const vals = entries.map(([, v]) =>
    typeof v === "boolean" ? Number(v) : v,
  ) as (string | number | null)[];
  return change(
    db,
    `UPDATE ${validIdentifier(table)} SET ${col} WHERE uid = ?`,
    ...vals,
    uid,
  );
}
export function transition<T extends Record<string, unknown>>(
  db: SqlDb,
  table: string,
  uid: string,
  from: string | string[],
  to: string,
  patch: Partial<T>,
  whitelist: readonly string[],
): boolean {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.some(([key]) => !whitelist.includes(key)))
    throw new Error("Forbidden transition patch field");
  const set = [
    "status = ?",
    ...entries.map(([k]) => `${validIdentifier(k)} = ?`),
  ].join(", ");
  const values = entries.map(([, v]) =>
    typeof v === "boolean" ? Number(v) : v,
  ) as (string | number | null)[];
  const statuses = Array.isArray(from) ? from : [from];
  if (statuses.length === 0) return false;
  return change(
    db,
    `UPDATE ${validIdentifier(table)} SET ${set} WHERE uid = ? AND status IN (${statuses.map(() => "?").join(",")})`,
    to,
    ...values,
    uid,
    ...statuses,
  );
}

const boolFields = {
  holders: ["excluded"],
  strategies: ["enabled"],
  packs: ["available"],
} as const;
export function decode<K extends keyof Tables>(
  table: K,
  row: unknown,
): Tables[K] {
  if (!row || typeof row !== "object") throw new Error("Expected database row");
  const data = { ...(row as Record<string, unknown>) };
  const bools = (boolFields as Record<string, readonly string[]>)[table] ?? [];
  for (const key of bools)
    if (key in data) data[key] = data[key] === true || data[key] === 1;
  return schemas[table].parse(data) as Tables[K];
}
export function record<K extends keyof Tables>(
  db: SqlDb,
  table: K,
  where: string,
  ...args: Array<string | number | null>
): Tables[K] | null {
  const r = one<Record<string, unknown>>(
    db,
    `SELECT * FROM ${table} WHERE ${where} LIMIT 1`,
    ...args,
  );
  return r ? decode(table, r) : null;
}
export function records<K extends keyof Tables>(
  db: SqlDb,
  table: K,
  where: string,
  ...args: Array<string | number | null>
): Tables[K][] {
  return rows<Record<string, unknown>>(
    db,
    `SELECT * FROM ${table} WHERE ${where}`,
    ...args,
  ).map((r) => decode(table, r));
}
