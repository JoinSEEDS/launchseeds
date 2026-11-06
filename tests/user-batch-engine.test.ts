import {test,expect} from "bun:test";
import {openLaunchseedsData} from "../src/db";
import {Store} from "../src/server/store";
import {insertToken} from "./fixtures";
import {UserBatchEngine,UserBatchStateSchema,type UserBatchChain} from "../src/server/user-batch-engine";
function fixture(){
 const store=new Store(openLaunchseedsData(":memory:")),token=insertToken(store,{mint:"2".repeat(32)});
 let count=0,simulation:string|null="target not met",saleReceipt:bigint|null=null,payoutReceipt:bigint|null=null,absent=false;
 const sent:string[]=[];
 const signed=(kind:string)=>({transaction:kind+ ++count,signature:kind+count,lastValidBlockHeight:100});
 const chain:UserBatchChain={sellFeeCap:50000n,settlementFeeCap:100000n,
  fills:async()=>({fills:[100n,200n],cost:1000000000n}),
  prepareSale:async(_state,minimum)=>{expect(minimum).toBe(1020150000n);return signed("sale");},
  needsRefresh:async()=>false,simulate:async()=>simulation,
  send:async transaction=>{sent.push(transaction);},status:async()=>"unknown",failedFee:async()=>null,
  absentAfterExpiry:async()=>absent,saleReceipt:async()=>saleReceipt,
  preparePayout:async state=>{expect(state.proceedsWallet).toBe("3".repeat(32));return signed("payout");},
  payoutReceipt:async()=>payoutReceipt,
  marketCapUsd:async()=>0,prepareTrancheBuy:async()=>signed("buy"),
 };
 const state=UserBatchStateSchema.parse({version:1,status:"buying",config:{slots:[500_000_000,500_000_000],exit:{kind:"profit",profitBps:200}},proceedsWallet:"3".repeat(32),mint:token.mint,buyers:[{name:"ace",wallet:"4".repeat(32),budgetLamports:"500000000",batchIndex:0,role:"signer"},{name:"b",wallet:"5".repeat(32),budgetLamports:"500000000",batchIndex:0,role:"fresh"}]});
 store.repo.userBatches.insert(token.id,0,JSON.stringify(state),Date.now());
 const read=()=>UserBatchStateSchema.parse(JSON.parse(store.repo.userBatches.byToken(token.id)[0]!.stateJson));
 return {store,token,chain,sent,read,engine:()=>new UserBatchEngine(store.repo,chain),ready(){simulation=null;},sale(value:bigint){saleReceipt=value;},payout(value:bigint){payoutReceipt=value;},absent(){absent=true;},count:()=>count};
}
test("batch waits for its aggregate target, saves before sending and resumes after restart",async()=>{
 const f=fixture();try{
  let engine=f.engine();await engine.tick();await engine.tick();
  expect(f.read().status).toBe("holding");expect(f.count()).toBe(1);expect(f.sent).toHaveLength(0);
  engine=f.engine();await engine.tick();expect(f.count()).toBe(1);
  f.ready();const send=f.chain.send;f.chain.send=async transaction=>{expect(f.read().status).toBe(transaction.startsWith("sale")?"exiting":"settling");await send(transaction);};
  await engine.tick();expect(f.read().status).toBe("exiting");expect(f.sent).toEqual(["sale1"]);
  await engine.tick();expect(f.count()).toBe(1);expect(f.sent).toEqual(["sale1","sale1"]);
  f.sale(1020100000n);await engine.tick();await engine.tick();expect(f.read().status).toBe("settling");
  f.payout(1060000000n);await engine.tick();expect(f.read().status).toBe("settled");
  expect(f.store.repo.userBatches.attempts(f.store.repo.userBatches.byToken(f.token.id)[0]!.id)).toHaveLength(2);
 }finally{f.store.close();}
});
test("unknown outcomes retain signed bytes; replacement requires proven absence",async()=>{
 const f=fixture();try{const engine=f.engine();await engine.tick();await engine.tick();f.ready();await engine.tick();await engine.tick();
  expect(f.read().sale!.signature).toBe("sale1");expect(f.count()).toBe(1);
  f.absent();await engine.tick();expect(f.read().status).toBe("holding");await engine.tick();expect(f.read().sale!.signature).toBe("sale2");
  expect(f.store.repo.userBatches.attempts(f.store.repo.userBatches.byToken(f.token.id)[0]!.id).map(attempt=>attempt.signature)).toEqual(["sale1","sale2"]);
 }finally{f.store.close();}
});
test("a confirmed sale below the net target goes to review rather than paying or selling again",async()=>{
 const f=fixture();try{const engine=f.engine();await engine.tick();await engine.tick();f.ready();await engine.tick();f.sale(1010000000n);await engine.tick();await engine.tick();expect(f.read().status).toBe("review");expect(f.count()).toBe(1);}finally{f.store.close();}
});
const force=(f:ReturnType<typeof fixture>)=>{const row=f.store.repo.userBatches.byToken(f.token.id)[0]!,state=f.read();
 expect(f.store.repo.userBatches.save(row.id,row.revision,JSON.stringify(UserBatchStateSchema.parse({...state,forced:true,...(state.status==="holding"?{sale:null}:{})})),Date.now())).toBe(true);};
test("admin finalize sells a holding column at market, without its profit minimum",async()=>{
 const f=fixture();try{const engine=f.engine();await engine.tick();await engine.tick();expect(f.read().sale!.signature).toBe("sale1");
  const minimums:Array<bigint|null>=[];f.chain.prepareSale=async(_s,minimum)=>{minimums.push(minimum);return {transaction:"sale-market",signature:"sale-market",lastValidBlockHeight:100};};
  force(f);f.ready();await engine.tick();expect(minimums).toEqual([null]);await engine.tick();expect(f.read().status).toBe("exiting");expect(f.sent).toEqual(["sale-market"]);
  f.sale(900000000n);await engine.tick();expect(f.read().status).toBe("exited");
 }finally{f.store.close();}
});
test("admin finalize resumes a column in review from its confirmed sale, and never re-sells it",async()=>{
 const f=fixture();try{const engine=f.engine();await engine.tick();await engine.tick();f.ready();await engine.tick();f.sale(1010000000n);await engine.tick();await engine.tick();
  expect(f.read().status).toBe("review");expect(f.store.repo.userBatches.all()).toHaveLength(0);
  force(f);expect(f.store.repo.userBatches.all()).toHaveLength(1);f.chain.status=async()=>"confirmed";
  await engine.tick();expect(f.read().status).toBe("exiting");await engine.tick();expect(f.read().status).toBe("exited");
  await engine.tick();expect(f.read().status).toBe("settling");expect(f.count()).toBe(2);
 }finally{f.store.close();}
});
test("a sale that fails on chain returns to holding, its fee added to the cost the target covers",async()=>{
 const f=fixture();try{const engine=f.engine();await engine.tick();await engine.tick();f.ready();await engine.tick();expect(f.read().status).toBe("exiting");
  f.chain.status=async()=>"failed";await engine.tick();expect(f.read().status).toBe("exiting");
  f.chain.failedFee=async()=>10000n;await engine.tick();
  expect(f.read()).toMatchObject({status:"holding",sale:null,buyCostLamports:"1000010000"});
  f.chain.prepareSale=async(_s,minimum)=>{expect(minimum).toBe(1020160200n);return {transaction:"sale-retry",signature:"sale-retry",lastValidBlockHeight:100};};
  await engine.tick();expect(f.read().sale!.signature).toBe("sale-retry");
 }finally{f.store.close();}
});
function trancheFixture(trigger:Record<string,unknown>){
 const store=new Store(openLaunchseedsData(":memory:")),launchedAt=1_000_000,token=insertToken(store,{mint:"2".repeat(32),launchedAt});
 let now=launchedAt,mcap=0,status:"confirmed"|"failed"|"pending"|"unknown"="unknown",fills:{fills:bigint[];cost:bigint}|null=null,count=0;
 const sent:string[]=[];
 const chain:UserBatchChain={sellFeeCap:0n,settlementFeeCap:0n,
  fills:async(_t,_b,state)=>{expect(state.buy).not.toBeNull();return fills;},
  prepareSale:async()=>({transaction:"sale",signature:"sale",lastValidBlockHeight:100}),
  needsRefresh:async()=>false,simulate:async()=>null,send:async transaction=>{sent.push(transaction);},
  status:async()=>status,failedFee:async()=>null,absentAfterExpiry:async()=>false,saleReceipt:async()=>null,
  preparePayout:async()=>({transaction:"payout",signature:"payout",lastValidBlockHeight:100}),payoutReceipt:async()=>null,
  marketCapUsd:async()=>mcap,prepareTrancheBuy:async()=>{count++;return {transaction:"buy"+count,signature:"buy"+count,lastValidBlockHeight:100};},
 };
 const state=UserBatchStateSchema.parse({version:1,status:"waiting",tranche:0,config:{slots:[50_000_000],trigger,exit:{kind:"immediate"}},proceedsWallet:"3".repeat(32),mint:token.mint,buyers:[{name:"t",wallet:"5".repeat(32),budgetLamports:"50000000",tranche:0,role:"fresh"}]});
 store.repo.userBatches.insert(token.id,4,JSON.stringify(state),Date.now());
 const read=()=>UserBatchStateSchema.parse(JSON.parse(store.repo.userBatches.byToken(token.id)[0]!.stateJson));
 const engine=new UserBatchEngine(store.repo,chain,()=>now);
 return {store,engine,sent,read,at:(ms:number)=>{now=launchedAt+ms;},mcap:(v:number)=>{mcap=v;},status:(v:typeof status)=>{status=v;},fill:(v:typeof fills)=>{fills=v;}};
}
test("a delayed tranche buys once its time comes, retries an unlanded buy, then holds",async()=>{
 const f=trancheFixture({kind:"delay",seconds:5});try{
  f.at(4_000);await f.engine.tick();expect(f.read().status).toBe("waiting");expect(f.sent).toEqual([]);
  f.at(5_000);await f.engine.tick();expect(f.read().status).toBe("buying");expect(f.read().buy!.signature).toBe("buy1");expect(f.sent).toEqual(["buy1"]);
  f.status("failed");await f.engine.tick();expect(f.read().status).toBe("waiting");expect(f.read().buy).toBeNull();
  f.status("unknown");await f.engine.tick();expect(f.read().buy!.signature).toBe("buy2");expect(f.read().buyAttempts).toBe(2);
  f.fill({fills:[10n],cost:50_005_000n});await f.engine.tick();expect(f.read().status).toBe("holding");expect(f.read().buyCostLamports).toBe("50005000");
 }finally{f.store.close();}
});
test("a market-cap tranche waits for its level and is skipped past its window or when finalized",async()=>{
 const f=trancheFixture({kind:"mcap",usd:50_000,withinSeconds:600});try{
  f.mcap(40_000);await f.engine.tick();expect(f.read().status).toBe("waiting");
  f.mcap(55_000);await f.engine.tick();expect(f.read().status).toBe("buying");
 }finally{f.store.close();}
 const g=trancheFixture({kind:"mcap",usd:50_000,direction:"below",withinSeconds:600});try{
  g.mcap(60_000);await g.engine.tick();expect(g.read().status).toBe("waiting");
  g.at(601_000);await g.engine.tick();expect(g.read().status).toBe("skipped");expect(g.sent).toEqual([]);
  await g.engine.tick();expect(g.read().status).toBe("skipped");
 }finally{g.store.close();}
 const h=trancheFixture({kind:"delay",seconds:60});try{
  const row=h.store.repo.userBatches.byToken(1)[0]??h.store.repo.userBatches.everyRun()[0]!;
  h.store.repo.userBatches.save(row.id,row.revision,JSON.stringify({...h.read(),forced:true}),Date.now());
  await h.engine.tick();expect(h.read().status).toBe("skipped");expect(h.sent).toEqual([]);
 }finally{h.store.close();}
});
