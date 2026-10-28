import { coinWebsite } from "../lib/coin-url";
import { publicRouteError } from "../src/server/route-errors";
import { expect,test } from "bun:test";
import { mkdtempSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openLaunchseedsData } from "../src/db";
import { Store } from "../src/server/store";
import { SolardLaunchProvider } from "../src/server/solard";
import type { TraderClient,MetadataUploader } from "../src/server/solard-sdk";
import { uploadedImagePath } from "../src/integrations/metadata";
import { assessLaunchReadiness } from "../lib/launch-operational-rules";
import { insertToken } from "./fixtures";

test("Solard IPFS upload is persisted and reused without an application URL",async()=>{
 const folder=mkdtempSync(join(tmpdir(),"launchseeds-ipfs-")),old=process.env.LAUNCHSEEDS_ASSETS_PATH;
 process.env.LAUNCHSEEDS_ASSETS_PATH=folder;
 const bytes=Buffer.from("89504e470d0a1a0a","hex"),digest=createHash("sha256").update(bytes).digest("hex"),image=`/api/media/${digest}.png`;
 writeFileSync(join(folder,`${digest}.png`),bytes);
 const store=new Store(openLaunchseedsData(":memory:"));
 let uploads=0;
 const upload:MetadataUploader=async(input,opts)=>{uploads++;expect(input.imagePath).toBe(join(folder,`${digest}.png`));expect(input.twitter).toBe("@launchseeds");expect(input.website).toBe(coinWebsite(mint));expect(opts).toEqual({provider:"pump-frontend",fallback:null});return {metadataUri:"ipfs://bafytestmetadata"};};
 const wallets:{name:string;address:string}[]=[];
 const add=(name:string,address:string)=>{wallets.push({name,address});return {name,address};};
 const sdk={listWallets:()=>wallets,
  importWallet:(_key:string,name:string)=>add(name,name.replace("launchseeds-mint-","")),
  createWallet:(name:string)=>add(name,"11111111111111111111111111111111")} as unknown as TraderClient;
 const provider=new SolardLaunchProvider(sdk,store,"https://api.mainnet-beta.solana.com",20000000,upload);
 // The mint keypair is created with the launch row, before preparation.
 const { mintSignerRef, mint } = provider.createMint();
 const tokenId=insertToken(store,{status:"preparing",mintSignerRef,fundingWallet:null,fundingWalletName:null,creatorWallet:null,rewardWallet:null,launchedAt:null}).id;
 try{
  const input={tokenId,name:"Test",symbol:"TEST",description:"Description",image,website:"",x:"@launchseeds",devBuyLamports:0};
  const failed=new SolardLaunchProvider(sdk,store,"https://api.mainnet-beta.solana.com",20000000,async()=>{throw new Error("Pump metadata upload failed (403)");});
  try { await failed.prepare(input); throw new Error("Expected failure"); }
  catch(error) {
    const response=publicRouteError(error);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("metadata upload failed");
    expect(store.repo.tokens.get(tokenId)?.metadataUri).toBeNull();
  }
  expect((await provider.prepare(input)).metadataUri).toBe("ipfs://bafytestmetadata");
  expect(store.repo.tokens.get(tokenId)?.metadataUri).toBe("ipfs://bafytestmetadata");
  const again=await provider.prepare(input);expect(uploads).toBe(1);
  // Both wallets are named by the CA and reused on retry, never regenerated.
  expect(wallets.map((w)=>w.name).sort()).toEqual([`launchseeds-${mint}`,`launchseeds-mint-${mint}`].sort());
  expect(again.fundingWalletName).toBe(`launchseeds-${mint}`);
  expect(again.mintSignerRef).toBe(`launchseeds-mint-${mint}`);
  writeFileSync(join(folder,`${digest}.png`),"tampered");
  await expect(uploadedImagePath(image)).rejects.toThrow("integrity");
  await expect(uploadedImagePath("/api/media/../../secret")).rejects.toThrow();
 }finally{store.close();if(old===undefined)delete process.env.LAUNCHSEEDS_ASSETS_PATH;else process.env.LAUNCHSEEDS_ASSETS_PATH=old;}
});

test("IPFS launches require no public app URL but still require RPC and a healthy worker",()=>{
 const now=Date.now();const input={now,flags:{launch:true,live:true,worker:true},config:{rpc:true,publicBase:false,signedIngress:true,feeLamports:20000000},worker:{active:true,healthy:true,heartbeatAt:now,cycleStartedAt:now,completedAt:now},rpc:{healthy:true,slot:1,checkedAt:now}};
 expect(assessLaunchReadiness(input).enabled).toBe(true);
 expect(assessLaunchReadiness({...input,worker:null}).enabled).toBe(false);
});
