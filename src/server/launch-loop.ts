import {createMeasure} from "measure-fn";
import {hasStrategy} from "../../lib/governance";
import type {Store} from "./store";
import type {LaunchService} from "./launch";
import type {BundleEngine} from "./bundle-engine";
const {measure}=createMeasure("launchseeds:launch");
export type LaunchCycleResult={errors:Array<{tokenId:number;operation:string;error:string}>};
/** Launch RPC work is independent of holder snapshots and governance cadence. */
export async function runLaunchCycle(input:{store:Store;launch:LaunchService;bundles?:BundleEngine}):Promise<LaunchCycleResult>{
 return measure("launch cycle",async()=>{
  const pending=input.store.repo.tokens.all().filter(t=>["preparing","funding","deploying"].includes(t.status)&&t.leaseUntil<=Date.now());
  const errors:LaunchCycleResult["errors"]=[];
  if(input.bundles) for(const line of await input.bundles.tick(id=>input.store.repo.tokens.get(id)??null))
    if(!/holding: not every wallet|waiting for the launch|done$/.test(line))console.log(`Bundle ${line}`);
  const funding=pending.filter(t=>t.status==="funding");
  let funded:Set<string>|undefined;
  if(funding.length&&input.launch.provider?.fundedWallets){
   try{funded=await input.launch.provider.fundedWallets(funding.flatMap(t=>t.fundingWallet?[t.fundingWallet]:[]));}
   catch(error){errors.push({tokenId:0,operation:"funding observation",error:error instanceof Error?error.message:"RPC unavailable"});funded=new Set();}
  }
  // Reconcile existing transactions before preparing further deployments.
  pending.sort((a,b)=>(a.status==="deploying"?0:a.status==="funding"?1:2)-(b.status==="deploying"?0:b.status==="funding"?1:2));
  for(const token of pending){
   if(token.status==="funding"&&funded&&!funded.has(token.fundingWallet??""))continue;
   try{await measure(`${token.id} ${token.status}`,async()=>{
    if(token.status==="preparing"){if(hasStrategy(token.id))await input.launch.resumePreparation(token.id);}
    else await input.launch.process(token.id);
   });}catch(error){errors.push({tokenId:token.id,operation:"launch",error:error instanceof Error?error.message:"Launch unavailable"});}
  }
  return {errors};
 });
}
/** Single-flight, coalesced wakeups. No overlapping launch cycles or forgotten jobs on shutdown. */
export function startLaunchLoop(options:{cycle:()=>Promise<LaunchCycleResult>;intervalMs?:number;onStart?:()=>void;onFinish?:(result:LaunchCycleResult)=>void;onError?:(error:unknown)=>void}){
 let stopped=false,pendingWake=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined;
 function wake(){
  if(stopped)return;
  if(inFlight){pendingWake=true;return;}
  if(timer)clearTimeout(timer);
  const task=(async()=>{try{options.onStart?.();const result=await options.cycle();options.onFinish?.(result);}catch(error){try{options.onError?.(error);}catch{console.error("Launch health observer failed");}}})();
  inFlight=task;
  void task.finally(()=>{
   inFlight=undefined;if(stopped)return;
   const delay=pendingWake?0:options.intervalMs??2000;pendingWake=false;
   timer=setTimeout(wake,delay);
  });
 }
 wake();
 return {wake,async stop(){stopped=true;if(timer)clearTimeout(timer);await inFlight;}};
}
