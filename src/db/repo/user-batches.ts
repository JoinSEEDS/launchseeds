import type { SqlDb } from "./util";
export function userBatchesRepo(db: SqlDb) {
  return {
    byToken(tokenId: number) { return db.userBatchRuns.select().where({tokenId}).orderBy("batchIndex","asc").all(); },
    all() { return db.userBatchRuns.select().where({active:true}).orderBy("id","asc").all(); },
    liquidation(tokenId:number) { return db.coinLiquidations.select().where({tokenId}).get() ?? null; },
    activeLiquidations() { return db.coinLiquidations.select().where({active:true}).orderBy("id","asc").all(); },
    startLiquidation(tokenId:number, stateJson:string, now:number) {
      return db.transaction(()=>{
        const existing=db.coinLiquidations.select().where({tokenId}).get();
        if(existing) return db.coinLiquidations.select().where({id:existing.id}).updateAll({stateJson,active:true,revision:existing.revision+1,updatedAt:now})>0;
        db.coinLiquidations.insert({tokenId,stateJson,revision:0,active:true,createdAt:now,updatedAt:now});return true;
      });
    },
    saveLiquidation(id:number, revision:number, stateJson:string, active:boolean, now:number) {
      return db.coinLiquidations.select().where({id,revision}).updateAll({stateJson,active,revision:revision+1,updatedAt:now})>0;
    },
    attempts(batchRunId:number) { return db.userBatchAttempts.select().where({batchRunId}).orderBy("id","asc").all(); },
    insert(tokenId: number, batchIndex: number, stateJson: string, now: number) {
      return db.userBatchRuns.insert({tokenId,batchIndex,stateJson,revision:0,createdAt:now,updatedAt:now});
    },
    save(id: number, revision: number, stateJson: string, now: number) {
      return db.transaction(()=>{
        if(!db.userBatchRuns.select().where({id,revision}).get())return false;
        const state=JSON.parse(stateJson);
        for(const kind of ["sale","payout"] as const){
          const record=state[kind];if(!record)continue;
          const existing=db.userBatchAttempts.select().where({batchRunId:id,kind,signature:record.signature}).get();
          const signedJson=JSON.stringify(record);
          if(existing&&existing.signedJson!==signedJson)throw Error("Signed batch attempt changed bytes");
          if(!existing)db.userBatchAttempts.insert({batchRunId:id,kind,signature:record.signature,signedJson,preparedAt:now});
        }
        return db.userBatchRuns.select().where({id,revision}).updateAll({stateJson,revision:revision+1,updatedAt:now,active:state.status!=="settled"&&(state.status!=="review"||state.forced===true)}) > 0;
      });
    },
  };
}
