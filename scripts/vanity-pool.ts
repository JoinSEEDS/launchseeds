/** LaunchSeeds's "pump"-suffix vanity mint pool (in this config's Solard database).
 * Frontend launches take their mint from it; an empty pool falls back to a
 * random mint. Keys are generated and encrypted on this machine only.
 *
 *   bun scripts/vanity-pool.ts --config .config.toml               # counts
 *   bun scripts/vanity-pool.ts --config .config.toml --generate 10 # grind and store 10
 *
 * Grinding a 4-character suffix takes minutes per mint (multi-worker). */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(`--${k}`); return i < 0 ? "" : args[i + 1] || ""; };
const config = Bun.TOML.parse(readFileSync(arg("config") || ".config.toml", "utf8")) as any;
process.env.SLRD_MASTER_KEY = config.slrd?.master_key || process.env.SLRD_MASTER_KEY || "";
if (!process.env.SLRD_MASTER_KEY) throw new Error("[slrd] master_key is required");
const dbPath = config.solard?.db_path || "./data/solard.sqlite";
const name: string = "@solard/core";
const core: any = await import(name);
const pool: any = await import("@solard/core/launches/pump/vanity-pool.ts" as string);
const db = (await import("@solard/core/db/database.ts" as string)).openDatabase(dbPath);

const count = () => {
  const by: Record<string, number> = {};
  for (const e of pool.listVanityMintPool({ suffix: "pump" }, db)) by[e.status] = (by[e.status] ?? 0) + 1;
  return by;
};
console.log(JSON.stringify({ db: dbPath, pump: count() }));
const n = Number(arg("generate") || "0");
for (let i = 0; i < n; i++) {
  const started = Date.now();
  const { mint } = await core.generateMintKeypairWithSuffix({ suffix: "pump", workers: 8, timeoutMs: 30 * 60_000 });
  pool.addVanityMintToPool(mint, "pump", db);
  console.log(`${i + 1}/${n} ${mint.publicKey.toBase58()} in ${Math.round((Date.now() - started) / 1000)}s`);
}
if (n) console.log(JSON.stringify({ pump: count() }));
