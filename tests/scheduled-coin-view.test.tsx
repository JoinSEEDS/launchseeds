import {test,expect} from "bun:test";
import {renderToString} from "tradjs/server/ssr";
import {createHash} from "node:crypto";
import {Keypair} from "@solana/web3.js";
import {Store} from "../src/server/store";
import {openLaunchseedsData} from "../src/db";
import {insertToken} from "./fixtures";
import {DEFAULT_LAUNCH_SETTINGS} from "../src/domain/launch-settings";
import {scheduledCommitment} from "../src/domain/scheduled-plan";
import {publicPlanForMint,scheduledCoinUrl} from "../src/server/scheduled-launches";
import {ScheduledCoin} from "../app/components/scheduled-coin";
import {launchCountdown} from "../lib/launch-countdown";
import {runWithBrand} from "../src/server/site-brand";
import {brandForHost} from "../lib/site-brand";
test("reserved coin renders before launch, reveals chart only live and respects domain scope",()=>{
 const store=new Store(openLaunchseedsData(":memory:")),address=()=>Keypair.generate().publicKey.toBase58(),mint=address();
 try {
 const settings={...DEFAULT_LAUNCH_SETTINGS,holderRewards:true,sniperSeconds:null,publishMint:true,publishProject:true,scheduledAt:Date.now()+3600000,bundleLamports:500000000,walletSharesBps:[3334,3333,3333] as [number,number,number],profitPolicy:{mode:"burn" as const}};
 const token=insertToken(store,{status:"funding",mintSignerRef:`launchseeds-mint-${mint}`,launchSettingsJson:JSON.stringify(settings)});
 const buyers=[0,1,2].map(i=>({name:"test"+i,wallet:address(),budgetLamports:"100000000"}));
 const planHash=createHash("sha256").update(JSON.stringify(scheduledCommitment(token,settings,buyers))).digest("hex");store.repo.scheduledPlans.save({tokenId:token.id,planHash,buyersJson:JSON.stringify(buyers),createdAt:Date.now()});
 const plan=publicPlanForMint(store,mint)!;expect(plan.mint).toBe(mint);
 expect(scheduledCoinUrl(store,plan.planHash)).toBe(`/coin/${mint}`);
 const pending=renderToString(<ScheduledCoin plan={plan}/>);expect(pending).toContain("Launch in");expect(pending).toContain(mint);expect(pending).not.toContain("<iframe");
 const live=renderToString(<ScheduledCoin plan={{...plan,status:"live"}}/>);expect(live).toContain("<iframe");expect(live).toContain(`dexscreener.com/solana/${mint}`);expect(live).toContain("Launched");
 runWithBrand(brandForHost("launchseeds.xyz",{LAUNCHSEEDS_VISIBLE_SINCE:new Date(Date.now()+1000).toISOString()}),()=>expect(publicPlanForMint(store,mint)).toBeNull());
 }finally{store.close();}
});
test("countdown changes from hours to seconds and never invents a launch",()=>{
 expect(launchCountdown(3661000,"scheduled",0)).toBe("Launch in 01:01:01");
 expect(launchCountdown(1000,"awaiting_payment",0)).toContain("00:01 · awaiting payment");
 expect(launchCountdown(1000,"scheduled",2000)).toContain("awaiting execution");
 expect(launchCountdown(1000,"missed",2000)).toContain("Schedule missed");
 expect(launchCountdown(1000,"live",2000)).toBe("Launched");
});
