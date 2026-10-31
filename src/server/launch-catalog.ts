import { ApiError } from "../../lib/api-security";
import type { CatalogFilter, CatalogPage } from "../../lib/catalog-pagination";
import type { TokenCardData } from "../../app/components/token-cards";
import type { CatalogBoundary, CatalogQuery } from "../db/repo/launch-catalog";
import type { Store } from "./store";
import type { Token } from "../db/schema";
import { currentBrand } from "./site-brand";
import { publicScheduledPlan } from "./scheduled-launches";
import { storedHomeObservations } from "./home-snapshot";
import { storedLaunchSettings } from "../domain/launch-settings";
import { bundleView } from "./bundle-view";
import { solAmount } from "../../app/components/scheduled-plan";
import { presentConfig } from "../../lib/governance";
import { displayStrategyCostMicros, holderFeesMicros } from "../../lib/reward-funding";

export const CATALOG_PAGE_SIZE=24;
export function readCatalogInput(params: URLSearchParams) {
  const filter=params.get("filter") ?? "all",q=(params.get("q")??"").trim();
  const after=params.get("after"),before=params.get("before");
  if (!["all","scheduled","live"].includes(filter) || q.length>80 || (after && before) || (after?.length??0)>1024 || (before?.length??0)>1024) throw new ApiError("Invalid launch catalogue query.",400);
  return {filter:filter as CatalogFilter,q,after,before};
}
export type CatalogInput=ReturnType<typeof readCatalogInput>;
const initial: CatalogInput={filter:"all",q:"",after:null,before:null};
export function catalogOptions(input: CatalogInput): CatalogQuery {
  const brand=currentBrand();
  return {filter:input.filter,q:input.q,launchseeds:brand.kind==="launchseeds",cutoff:brand.visibleSince,excludeMint:process.env.LAUNCHSEEDS_TOKEN_MINT?.trim()??""};
}
function boundary(input: CatalogInput, query: CatalogQuery): CatalogBoundary|undefined {
  const text=input.after??input.before;if(!text)return;
  try {
    const data=JSON.parse(Buffer.from(text,"base64url").toString("utf8"));
    if(!Number.isSafeInteger(data.at)||data.at<0||!Number.isSafeInteger(data.id)||data.id<=0||data.scope!==JSON.stringify(query))throw new Error();
    return {at:data.at,id:data.id,direction:input.after?"after":"before"};
  }catch{throw new ApiError("This page cursor does not match the current search. Start from the first page.",400);}
}
const cursor=(token:Token,query:CatalogQuery)=>Buffer.from(JSON.stringify({at:token.createdAt,id:token.id,scope:JSON.stringify(query)})).toString("base64url");

export function catalogRows(store: Store,input: CatalogInput=initial) {
  const query=catalogOptions(input),edge=boundary(input,query);
  const found=store.repo.launchCatalog.page(query,edge),extra=found.length>CATALOG_PAGE_SIZE;
  const rows=found.slice(0,CATALOG_PAGE_SIZE);
  if(edge?.direction==="before")rows.reverse();
  const hasNext=edge?.direction==="before"?rows.length>0:extra;
  const hasPrevious=edge?.direction==="before"?extra:!!edge&&rows.length>0;
  return {rows,filter:input.filter,q:input.q,total:store.repo.launchCatalog.count(query),pageSize:CATALOG_PAGE_SIZE,next:hasNext&&rows.length?cursor(rows[rows.length-1]!,query):null,previous:hasPrevious&&rows.length?cursor(rows[0]!,query):null};
}

export function launchCatalog(store: Store,input: CatalogInput=initial): CatalogPage {
  const {rows,...page}=catalogRows(store,input);
  // Cold snapshot fallbacks hydrate only this page, never the complete token list.
  const observations=storedHomeObservations(store,Date.now(),rows.map(t=>t.id));
  const items:TokenCardData[]=rows.map(raw=>{
    const settings=storedLaunchSettings(raw.launchSettingsJson);
    if(raw.status!=="live") {
      const saved=store.repo.scheduledPlans.byToken(raw.id);
      const plan=saved?publicScheduledPlan(store,saved.planHash):null;
      return {key:plan?.planHash??String(raw.id),mint:plan?.mint??null,name:raw.name,symbol:raw.symbol,image:raw.image,href:plan?`/coin/${plan.mint??plan.planHash}`:"/",status:plan?.status??"needs_review",scheduledAt:settings.scheduledAt,createdAt:raw.createdAt,marketCap:null,protection:settings.bundleLamports?solAmount(String(settings.bundleLamports)):null,target:settings.bundleExitPercent,profit:null,destination:settings.profitPolicy?.mode==="burn"?"buy & burn":settings.profitPolicy?.mode==="token"?"$TOKEN holder reward":"to the published wallet",holderRewards:false};
    }
    const token=store.view(raw),bundle=bundleView(store,raw.id);
    const observation=observations.capPairs.find(r=>r.id===raw.id);
    const strategy=raw.activeStrategyId?store.repo.strategies.get(raw.activeStrategyId):null;
    const active=strategy?presentConfig(strategy.configJson):null;
    const cost=active&&!settings.holderRewards?displayStrategyCostMicros(active,observations.catalog,active.type==="pack"?store.repo.packs.get(active.ref)?.priceUsdCents:undefined):null;
    const claimed=Math.max(0,token.collectedMicros-token.spentMicros-token.reservedMicros);
    const available=claimed+holderFeesMicros(observation?.fees??0,raw.launchSettingsJson);
    const plan=store.repo.scheduledPlans.byToken(raw.id);
    return {key:raw.mint!,mint:raw.mint,name:raw.name,symbol:raw.symbol,image:raw.image,href:`/coin/${encodeURIComponent(raw.mint!)}`,status:"live",scheduledAt:settings.scheduledAt,createdAt:raw.createdAt,marketCap:observation?.cap??null,protection:bundle?solAmount(bundle.totalLamports):null,target:bundle?.exitTargetPercent??null,profit:bundle?.profitLamports===null||!bundle?null:solAmount(bundle.profitLamports),destination:settings.profitPolicy?.mode==="burn"?"buy & burn":settings.profitPolicy?.mode==="wallet"?"to the published wallet":bundle?"legacy $TOKEN rewards":null,holderRewards:!plan&&settings.holderRewards,...(!settings.holderRewards&&cost?{legacyFunding:`Funded $${(available/1e6).toFixed(2)} \u00b7 Reward $${(cost/1e6).toFixed(2)}`,legacySurplus:available>cost?`Surplus $${((available-cost)/1e6).toFixed(2)}`:undefined,legacyPercent:Math.min(100,Math.round(100*available/cost)),legacyFees:observation?.fees!==null&&observation?.fees!==undefined?`$${(observation.fees/1e6).toFixed(2)}`:undefined}:{})};
  });
  return {...page,items};
}
export function catalogOverview(store:Store) {
  const query=catalogOptions(initial);
  const candidates=store.repo.launchCatalog.nextScheduled(query,Date.now()).flatMap(token=>{
    const saved=store.repo.scheduledPlans.byToken(token.id);
    const plan=saved?publicScheduledPlan(store,saved.planHash):null;
    return plan?.status==="scheduled"?[plan]:[];
  }).sort((a,b)=>a.scheduledAt-b.scheduledAt);
  return {live:store.repo.launchCatalog.count({...query,filter:"live"}),scheduled:store.repo.launchCatalog.count({...query,filter:"scheduled"}),next:candidates[0]??null};
}
