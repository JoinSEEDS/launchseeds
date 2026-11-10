import { test,expect } from "bun:test";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { insertToken } from "./fixtures";
import { catalogRows,launchCatalog,readCatalogInput } from "../src/server/launch-catalog";
import { runForSite,currentRequestUrl } from "../src/server/site-brand";
import { scheduledCommitment } from "../src/domain/scheduled-plan";
import { DEFAULT_LAUNCH_SETTINGS } from "../src/domain/launch-settings";
const input=(q="")=>readCatalogInput(new URLSearchParams(q));
test("database pagination crosses timestamp ties without duplicates, reverses and searches before limit",()=>{
 const store=new Store(openLaunchseedsData(":memory:"));
 for(let i=0;i<57;i++)insertToken(store,{fundingWallet:"5".repeat(31)+"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i],name:i===0?"Rare % project":"Project "+i,symbol:"P"+i,mint:"2".repeat(31)+"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i],createdAt:1000});
 const first=catalogRows(store),second=catalogRows(store,input("after="+first.next)),third=catalogRows(store,input("after="+second.next));
 expect([first.rows.length,second.rows.length,third.rows.length]).toEqual([24,24,9]);
 expect(new Set([...first.rows,...second.rows,...third.rows].map(t=>t.id)).size).toBe(57);
 expect(catalogRows(store,input("before="+second.previous)).rows.map(t=>t.id)).toEqual(first.rows.map(t=>t.id));
 expect(catalogRows(store,input("q=Rare+%25")).rows.map(t=>t.symbol)).toEqual(["P0"]);
 expect(()=>catalogRows(store,input("q=other&after="+first.next))).toThrow("cursor");
 store.listLive=()=>{throw Error("unbounded hydration");};
 expect(launchCatalog(store).items).toHaveLength(24);
});
test("SSR URL context is request local",async()=>{
 await Promise.all(["one","two"].map(q=>runForSite(new Request("https://launchseeds.xyz/?q="+q),async()=>{await Promise.resolve();expect(new URL(currentRequestUrl()!).searchParams.get("q")).toBe(q);})));expect(currentRequestUrl()).toBeUndefined();
});
test("project text is committed when published and accepts multiline detail",()=>{
 const token={name:"Project",symbol:"PRJ",image:"/image",description:"Purpose\n"+"a".repeat(3000)};
 const old=scheduledCommitment(token,{...DEFAULT_LAUNCH_SETTINGS,publishProject:false},[]);
 expect(old).not.toHaveProperty("description");
 const settings={...DEFAULT_LAUNCH_SETTINGS,publishMint:true,publishProject:true};
 expect(scheduledCommitment(token,settings,[])).toMatchObject({version:1,description:token.description});
 expect(scheduledCommitment({...token,description:"Edited"},settings,[])).not.toEqual(scheduledCommitment(token,settings,[]));
});
