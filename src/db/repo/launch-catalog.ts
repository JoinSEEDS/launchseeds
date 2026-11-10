import type { SqlDb } from "./util";
export type CatalogQuery = {
  filter: "all" | "live" | "scheduled";
  q: string;
};
export type CatalogBoundary = { at: number; id: number; direction: "after" | "before" };

/** ORM expressions apply scope, search and status before the database limit. */
export function launchCatalogRepo(db: SqlDb) {
  function query(input: CatalogQuery) {
    return db.tokens.select().where((c, f, op) => {
      const json = f.iif(f.json_valid(c.launchSettingsJson), c.launchSettingsJson, "{}");
      const scheduledAt = f.json_extract(json, "$.scheduledAt");
      const live = op.eq(c.status, "live");
      const scheduled = op.and(op.isNotNull(scheduledAt), op.or(op.eq(c.status,"funding"),op.or(op.eq(c.status,"deploying"),op.eq(c.status,"failed"))));
      let condition = input.filter === "live" ? live : input.filter === "scheduled" ? scheduled : op.or(live,scheduled);
      if (input.q) {
        // INSTR treats % and _ as literal characters, not wildcard operators.
        const term = input.q.replace(/[A-Z]/g, s=>s.toLowerCase());
        condition=op.and(condition,op.or(op.gt(f.instr(f.lower(c.name),term),0),op.or(op.gt(f.instr(f.lower(c.symbol),term),0),op.gt(f.instr(f.lower(f.coalesce(c.mint,c.mintSignerRef,"")),term),0))));
      }
      return condition;
    });
  }
  return {
    page(input: CatalogQuery, boundary?: CatalogBoundary) {
      const q=query(input);
      if (boundary) q.where((c,_f,op)=> {
        const compare=boundary.direction === "after" ? op.lt : op.gt;
        return op.or(compare(c.createdAt,boundary.at),op.and(op.eq(c.createdAt,boundary.at),compare(c.id,boundary.id)));
      });
      const direction=boundary?.direction === "before" ? "asc" : "desc";
      return q.orderBy("createdAt",direction).orderBy("id",direction).limit(25).all();
    },
    count(input: CatalogQuery) { return query(input).count(); },
    nextScheduled(input: CatalogQuery, now: number) {
      return query({...input,filter:"scheduled",q:""}).where((c,f,op)=> {
        const json=f.iif(f.json_valid(c.launchSettingsJson),c.launchSettingsJson,"{}");
        const received=c.fundingReceivedLamports,required=c.requiredLamports;
        const enough=op.or(op.gt(f.length(received),f.length(required)),op.and(op.eq(f.length(received),f.length(required)),op.gte(received,required)));
        return op.and(op.gt(f.json_extract(json,"$.scheduledAt"),now),op.and(op.ne(required,"0"),enough));
      }).orderBy("createdAt","asc").limit(8).all();
    },
  };
}
