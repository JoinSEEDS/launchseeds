import { z } from "zod";
import { MAX_TRANCHES, TrancheSchema, UserBatchSchema, batchMinimumOutput } from "../domain/user-funded-batches";
import type { LaunchseedsRepo } from "../db/repo";
import { tickLiquidations, type CoinLiquidationChain } from "./coin-liquidation";

const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const signed = z.object({transaction:z.string().min(1),signature:z.string().min(1),lastValidBlockHeight:z.number().int().positive()}).strict();
export const UserBatchStateSchema = z.object({
  version:z.literal(1),
  /** waiting: a tranche before its trigger; skipped: a tranche that never bought. */
  status:z.enum(["waiting","buying","holding","exiting","exited","settling","settled","skipped","review"]),
  config:z.union([UserBatchSchema,TrancheSchema]),
  /** Set on a post-launch tranche (its row's batchIndex is TRANCHE_ROW_OFFSET + tranche). */
  tranche:z.number().int().min(0).max(MAX_TRANCHES-1).optional(),
  /** A tranche's own buy transaction, journaled before it is sent. */
  buy:signed.nullable().default(null),
  buyAttempts:z.number().int().nonnegative().default(0),
  /** The launch's one proceeds wallet (every column pays out to it). */
  proceedsWallet:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  mint:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  /** buyers[0] is the column's signer: a reused pool wallet, whose payout is
   * only this launch's own net flows (its other funds are never touched). */
  buyers:z.array(z.object({name:z.string(),wallet:z.string(),budgetLamports:amount,batchIndex:z.number().int().min(0).max(3).optional(),tranche:z.number().int().optional(),role:z.enum(["signer","fresh"]).optional()})).min(1).max(6),
  fills:z.array(amount).default([]),
  buyCostLamports:amount.default("0"),
  sale:signed.nullable().default(null),
  payout:signed.nullable().default(null),
  netSaleLamports:amount.nullable().default(null),
  paidLamports:amount.nullable().default(null),
  error:z.string().nullable().default(null),
  /** An admin finalized the coin: sell at market now, whatever the published
   * rule, and recover a column stuck in review from what the chain shows. */
  forced:z.boolean().default(false),
  /** A ladder exit's next wallet, and the net SOL of the wallets already sold. */
  ladderIndex:z.number().int().nonnegative().default(0),
  ladderNet:amount.default("0"),
}).strict();
export type UserBatchState = z.infer<typeof UserBatchStateSchema>;
type Signed = z.infer<typeof signed>;
/** Who the next sale sells: a ladder's next wallet, otherwise all of them. */
export const saleBuyers=(state:UserBatchState)=>
  state.config.exit.kind==="ladder"&&!state.forced?[state.buyers[state.ladderIndex]!]:state.buyers;
export type UserBatchChain = {
  sellFeeCap:bigint;
  settlementFeeCap:bigint;
  /** USD market cap of the coin now (tranche triggers). */
  marketCapUsd(mint:string):Promise<number>;
  /** A tranche's buy: the deposit wallet funds each tranche wallet and pays the
   * fee, and every wallet buys its slot, in one transaction. */
  prepareTrancheBuy(tokenId:number,state:UserBatchState):Promise<Signed>;
  /** Verified finalized buy spend and fees; excludes unspent reserves/refundable rent. */
  fills(tokenId:number,batchIndex:number,state:UserBatchState):Promise<{fills:bigint[];cost:bigint}|null>;
  /** Consolidate recorded fills and sell once, atomically enforcing the combined
   * SOL minimum, or the minimum that keeps the market cap at `floorUsd`. */
  prepareSale(state:UserBatchState,minimumOutput:bigint|null,floorUsd?:number):Promise<Signed>;
  needsRefresh(height:number):Promise<boolean>;
  simulate(transaction:string):Promise<string|null>;
  send(transaction:string):Promise<void>;
  status(signature:string):Promise<"confirmed"|"failed"|"pending"|"unknown">;
  /** Network fee of a finalized transaction that failed on chain; null otherwise. */
  failedFee(signature:string):Promise<bigint|null>;
  /** Finalized expiry followed by fresh signature history and transaction absence. */
  absentAfterExpiry(signature:string,height:number):Promise<boolean>;
  /** Exact signed-sale receipt, validated against wallets/mint, after network fees. */
  saleReceipt(state:UserBatchState):Promise<bigint|null>;
  /** Close empty accounts and send this column's SOL to the proceeds wallet:
   * fresh wallets in full, the signer only this launch's net flows; within fee cap. */
  preparePayout(state:UserBatchState):Promise<Signed>;
  payoutReceipt(state:UserBatchState):Promise<bigint|null>;
};

const MAX_BUY_ATTEMPTS = 5;

/** Single-flight coordinator. Signed outcomes are never reset on a timeout alone. */
export class UserBatchEngine {
  private running = false;
  constructor(readonly repo:LaunchseedsRepo,readonly chain:UserBatchChain&{liquidation?:CoinLiquidationChain},readonly now:()=>number=Date.now) {}
  async tick() {
    if (this.running) return [];
    this.running=true;
    const messages:string[]=[];
    try {
      for (const row of this.repo.userBatches.all()) {
        const state=UserBatchStateSchema.parse(JSON.parse(row.stateJson));
        if(state.status==="settled"||state.status==="skipped"||(state.status==="review"&&!state.forced))continue;
        try { messages.push(`${row.tokenId}/${row.batchIndex}: ${await this.advance(row,state)}`); }
        catch(error){messages.push(`${row.tokenId}/${row.batchIndex}: ${error instanceof Error?error.message:"Batch unavailable"}`);}
      }
      // Admin "liquidate everything" jobs, after the columns have advanced.
      if(this.chain.liquidation)messages.push(...await tickLiquidations(this.repo,this.chain.liquidation));
    }finally{this.running=false;}
    return messages;
  }
  private async advance(row:{id:number;tokenId:number;batchIndex:number;revision:number},state:UserBatchState) {
    const save=(patch:Partial<UserBatchState>)=>this.repo.userBatches.save(row.id,row.revision,JSON.stringify(UserBatchStateSchema.parse({...state,...patch})),this.now());
    const review=(error:string)=>{save({status:"review",error});return error;};
    switch(state.status){
      case "waiting": {
        if(state.tranche===undefined||!("trigger" in state.config))return review("Tranche configuration missing");
        if(state.forced){save({status:"skipped",error:"Finalized before the tranche fired"});return "tranche skipped (finalized)";}
        const token=this.repo.tokens.get(row.tokenId);
        if(token?.status!=="live"||!token.launchedAt)return "waiting for the launch";
        const trigger=state.config.trigger,since=this.now()-token.launchedAt;
        if(trigger.kind==="delay"){
          if(since<trigger.seconds*1000)return `fires in ${Math.ceil((trigger.seconds*1000-since)/1000)}s`;
        }else{
          if(since>trigger.withinSeconds*1000){save({status:"skipped",error:"The market cap level was not reached in time"});return "tranche skipped: level not reached";}
          const mcap=await this.chain.marketCapUsd(state.mint);
          if(trigger.direction==="above"?mcap<trigger.usd:mcap>trigger.usd)return `waiting: market cap $${Math.round(mcap)}`;
        }
        if(state.buyAttempts>=MAX_BUY_ATTEMPTS){save({status:"skipped",error:"The tranche buy did not land after several attempts"});return "tranche skipped";}
        const buy=await this.chain.prepareTrancheBuy(row.tokenId,state);
        const problem=await this.chain.simulate(buy.transaction);
        if(problem)return "tranche buy: "+problem.slice(0,120);
        if(!save({status:"buying",buy,buyAttempts:state.buyAttempts+1,error:null}))return "tranche changed before submission";
        await this.chain.send(buy.transaction);
        return "tranche buy sent";
      }
      case "buying": {
        const fill=await this.chain.fills(row.tokenId,row.batchIndex,state);
        if(!fill&&state.tranche!==undefined&&state.buy){
          // An unlanded tranche buy goes back to its trigger; nothing was bought.
          const status=await this.chain.status(state.buy.signature);
          if(status==="failed"||(status==="unknown"&&await this.chain.absentAfterExpiry(state.buy.signature,state.buy.lastValidBlockHeight))){
            save({status:"waiting",buy:null,error:`Tranche buy ${status==="failed"?"failed on chain":"expired"}; retrying`});
            return "tranche buy did not land; retrying";
          }
          if(status!=="confirmed"&&!await this.chain.needsRefresh(state.buy.lastValidBlockHeight))await this.chain.send(state.buy.transaction);
          return "waiting for the finalized tranche buy";
        }
        if(!fill)return "waiting for finalized launch fills";
        if(fill.fills.length!==state.buyers.length||fill.fills.some(amount=>amount<=0n)||fill.cost<=0n)return review("Invalid confirmed buy accounting");
        save({status:"holding",fills:fill.fills.map(String),buyCostLamports:String(fill.cost)});
        return "buy accounting confirmed";
      }
      case "holding": {
        const exit=state.forced?{kind:"immediate" as const}:state.config.exit;
        if(exit.kind==="time"&&this.now()<exit.at)return "waiting for scheduled sale";
        const floorUsd=exit.kind==="floor"||exit.kind==="ladder"?exit.usd:undefined;
        // Each floor sale is judged after the last one lands, not alongside it.
        if(floorUsd!==undefined&&this.repo.userBatches.byToken(row.tokenId).some(other=>other.id!==row.id&&UserBatchStateSchema.parse(JSON.parse(other.stateJson)).status==="exiting"))return "waiting for this coin's other sale";
        let ready=state.sale;
        if(!ready||await this.chain.needsRefresh(ready.lastValidBlockHeight)){
          const minimum=exit.kind==="profit"?batchMinimumOutput(BigInt(state.buyCostLamports),exit.profitBps,this.chain.sellFeeCap,this.chain.settlementFeeCap):null;
          ready=await this.chain.prepareSale(state,minimum,floorUsd);
          // A finalized ladder sells every remaining wallet in this one sale.
          save({sale:ready,error:null,...(state.forced&&state.config.exit.kind==="ladder"?{ladderIndex:state.buyers.length-1}:{})});
          return "atomic sale prepared";
        }
        const problem=await this.chain.simulate(ready.transaction);
        if(problem)return "holding: "+problem;
        if(!save({status:"exiting"}))return "batch changed before submission";
        await this.chain.send(ready.transaction);
        return "sale submitted";
      }
      case "exiting": {
        if(!state.sale)return review("Sale journal missing");
        const receipt=await this.chain.saleReceipt(state);
        if(receipt!==null){
          if(receipt<0n)return review("Invalid sale receipt");
          if(state.config.exit.kind==="profit"&&!state.forced){
            const required=batchMinimumOutput(BigInt(state.buyCostLamports),state.config.exit.profitBps,0n,this.chain.settlementFeeCap);
            if(receipt<required)return review("Confirmed net sale did not meet the published batch target");
          }
          const net=BigInt(state.ladderNet)+receipt;
          if(state.config.exit.kind==="ladder"&&state.ladderIndex+1<state.buyers.length){
            save({status:"holding",sale:null,ladderIndex:state.ladderIndex+1,ladderNet:String(net),error:null});
            return `ladder wallet ${state.ladderIndex+1} of ${state.buyers.length} sold`;
          }
          save({status:"exited",netSaleLamports:String(net)});return "sale finalized";
        }
        const status=await this.chain.status(state.sale.signature);
        if(status==="failed"){
          // A failed sale (e.g. its minimum tripped as the price moved) leaves the
          // tokens in place; its fee joins the cost the net target must cover.
          const fee=await this.chain.failedFee(state.sale.signature);
          if(fee===null)return "waiting for the failed sale to finalize";
          save({status:"holding",sale:null,buyCostLamports:String(BigInt(state.buyCostLamports)+fee),error:"Previous sale failed on chain; its fee was added to the cost"});
          return "sale failed on chain; holding again";
        }
        if(status==="unknown"&&await this.chain.absentAfterExpiry(state.sale.signature,state.sale.lastValidBlockHeight)){
          // Retain original bytes in the journal until a new unsent candidate replaces them.
          save({status:"holding",sale:null,error:"Previous sale conclusively failed or expired without landing"});return "sale eligible for replacement";
        }
        if(status!=="confirmed"&&!await this.chain.needsRefresh(state.sale.lastValidBlockHeight))await this.chain.send(state.sale.transaction);
        return "waiting for finalized sale";
      }
      case "exited": {
        const payout=await this.chain.preparePayout(state);
        if(!save({status:"settling",payout,error:null}))return "batch changed before payout";
        await this.chain.send(payout.transaction);return "proceeds payout submitted";
      }
      case "settling": {
        if(!state.payout)return review("Payout journal missing");
        const paid=await this.chain.payoutReceipt(state);
        if(paid!==null){
          if(paid<0n||state.netSaleLamports===null||(!state.forced&&paid+this.chain.settlementFeeCap<BigInt(state.netSaleLamports)))return review("Confirmed payout did not cover the recorded proceeds within the fee cap");
          save({status:"settled",paidLamports:String(paid),error:null});return "proceeds delivered";
        }
        const status=await this.chain.status(state.payout.signature);
        if(status==="failed")return review("Payout failed on chain; reconcile its charged fee before rebuilding");
        if(status==="unknown"&&await this.chain.absentAfterExpiry(state.payout.signature,state.payout.lastValidBlockHeight)){
          save({status:"exited",error:"Payout finalized expiry and history absence verified"});return "payout eligible for replacement";
        }
        if(status!=="confirmed"&&!await this.chain.needsRefresh(state.payout.lastValidBlockHeight))await this.chain.send(state.payout.transaction);
        return "waiting for finalized proceeds payout";
      }
      case "review": {
        // Only reached when forced. Resume from what the chain shows; never
        // rebuild a sale or payout that may have landed.
        const manual=(why:string)=>{save({forced:false,error:`${state.error ?? "Review"} (finalize: ${why})`});return `needs manual review: ${why}`;};
        for(const kind of ["payout","sale"] as const){
          const journal=state[kind];if(!journal)continue;
          const status=await this.chain.status(journal.signature);
          const absent=status==="unknown"&&await this.chain.absentAfterExpiry(journal.signature,journal.lastValidBlockHeight);
          if(status==="confirmed"){save({status:kind==="payout"?"settling":"exiting",error:null});return `resuming confirmed ${kind}`;}
          if(status==="failed"||absent){
            if(kind==="payout"){save({status:"exited",payout:null,error:null});return "rebuilding payout";}
            save({status:"holding",sale:null,error:null});return "rebuilding sale at market";
          }
          return `waiting: ${kind} still ${status}`;
        }
        if(state.fills.length===state.buyers.length&&state.fills.length>0&&BigInt(state.buyCostLamports)>0n){save({status:"holding",sale:null,error:null});return "selling at market";}
        return manual("no confirmed buy accounting");
      }
      default:return "done";
    }
  }
}
