import {test,expect} from "bun:test";
import {JSDOM} from "jsdom";
import mount from "../app/page.client";
import {renderToString} from "tradjs/server/ssr";
import {TokenCards} from "../app/components/token-cards";
import type {CatalogPage} from "../lib/catalog-pagination";
const base:CatalogPage={items:[],filter:"all",q:"",total:0,pageSize:24,next:"next",previous:null};
test("catalogue aborts stale requests, retains results on failure and cleans up",async()=>{
 const dom=new JSDOM(`<div id="token-cards"></div><nav id="catalog-pagination"><a href="/?after=next">Next</a></nav><p id="catalog-status"></p><a data-card-filter="live" href="/?filter=live">Live</a><input data-card-search />`,{url:"http://localhost/"});
 const names=["window","document","location","history","Element","DOMException"] as const;
 const saved=names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)] as const),oldFetch=globalThis.fetch;
 let cleanup:(()=>void)|undefined;
 const requests:Array<{resolve:(r:Response)=>void,signal:AbortSignal,url:string}>=[];
 try {
  for(const n of names)Object.defineProperty(globalThis,n,{configurable:true,value:(dom.window as any)[n]});
  dom.window.document.getElementById("token-cards")!.dataset.page=JSON.stringify(base);
  globalThis.fetch=((url:any,options:any)=>new Promise<Response>(resolve=>requests.push({url:String(url),signal:options.signal,resolve}))) as typeof fetch;
  cleanup=mount();
  dom.window.document.querySelector<HTMLAnchorElement>("#catalog-pagination a")!.click();
  dom.window.document.querySelector<HTMLAnchorElement>("[data-card-filter]")!.click();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[1]!.url).toBe("/api/launch-catalog?filter=live");
  requests[1]!.resolve(Response.json({...base,filter:"live",total:12,next:null}));await new Promise(r=>setTimeout(r,10));
  requests[0]!.resolve(Response.json({...base,total:99}));await new Promise(r=>setTimeout(r,10));
  expect(dom.window.document.getElementById("catalog-status")!.textContent).toBe("12 launches");expect(dom.window.location.search).toBe("?filter=live");
  dom.window.document.querySelector<HTMLAnchorElement>("[data-card-filter]")!.click();requests[2]!.resolve(new Response("error",{status:503}));await new Promise(r=>setTimeout(r,10));
  expect(dom.window.document.getElementById("catalog-status")!.textContent).toContain("Could not load");
 }finally{cleanup?.();globalThis.fetch=oldFetch;for(const [n,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,n,descriptor);else delete (globalThis as any)[n];}dom.window.close();}
});
