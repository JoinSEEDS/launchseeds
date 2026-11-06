import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createCloseAccountInstruction, getMint } from "@solana/spl-token";
import bs58 from "bs58";
import type { LaunchseedsRepo } from "../db/repo";
import { saleBuyers, type UserBatchChain, type UserBatchState } from "./user-batch-engine";
import { floorSaleMinimum } from "../domain/user-funded-batches";
import type { CoinLiquidationChain } from "./coin-liquidation";
import type { BundleContext, PreparedExit } from "./launch-bundle-solard";
import { simulateRaw } from "./launch-bundle-solard";
import { BUYER_RESERVE_LAMPORTS, parseBundleIntent, V1_PACKET_LIMIT } from "./launch-bundle";
import { rpcFetch } from "./rpc-pacing";
import { loadWireTransaction } from "./solard-sdk";

type Receipt = {
  transaction:{signatures:string[];message:{accountKeys:string[]}};
  meta:{err:unknown;fee:number;preBalances:number[];postBalances:number[];preTokenBalances?:TokenBalance[];postTokenBalances?:TokenBalance[]};
};
type TokenBalance = {accountIndex:number;owner?:string;mint:string;uiTokenAmount:{amount:string}};
type Market = {baseTokenProgram:PublicKey;quoteAsset:{kind:string};metadata?:{curve?:Reserves;reserves?:Reserves}};
type Reserves = {virtualBase:bigint;virtualQuote:bigint};
type Quote = {inputRaw:bigint;minimumOutputRaw:bigint;expectedOutputRaw:bigint;meta?:Record<string,unknown>};
type Plugin = {
  resolveMarket(context:unknown):Promise<Market|null>;
  quoteSell(context:unknown,market:Market,amount:bigint,slippage:number):Promise<Quote>;
  quoteBuy(context:unknown,market:Market,amount:{raw:bigint;asset:unknown},slippage:number):Promise<Quote>;
  buildBuy(context:unknown,market:Market,quote:Quote):Promise<{instructions:TransactionInstruction[]}>;
  buildSell(context:unknown,market:Market,quote:Quote):Promise<{instructions:TransactionInstruction[];minOutputRaw?:bigint}>;
};
const FEE_CAP = 100_000n;

/** Native-SOL Pump and PumpSwap batch execution using Solard's venue builders. */
export function createUserBatchChain(ctx:BundleContext,repo:LaunchseedsRepo,loadToken:(mint:string)=>Promise<unknown>,solUsd:()=>Promise<number>):UserBatchChain&{liquidation:CoinLiquidationChain} {
  async function pump(){
    const moduleName:string="@solard/core/venues/pump/pump-plugin.ts";
    return new ((await import(moduleName)) as {PumpPlugin:new()=>Plugin}).PumpPlugin();
  }
  async function rpc(method:string,params:unknown[]) {
    const response=await rpcFetch(ctx.rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(10_000)});
    const body=await response.json() as {result?:unknown;error?:unknown};
    if(!response.ok||body.error||!("result" in body))throw Error(`Batch ${method} unavailable`);
    return body.result;
  }
  async function finalizedTransaction(signature:string){
    return await rpc("getTransaction",[signature,{encoding:"json",commitment:"finalized",maxSupportedTransactionVersion:1}]) as Receipt|null;
  }
  /** A finalized successful receipt; null while not finalized or when it failed
   * on chain (the engine then reads the failure through status()). */
  async function receipt(signature:string):Promise<Receipt|null>{
    const value=await finalizedTransaction(signature);
    if(!value)return null;
    if(!value.meta||value.transaction.signatures[0]!==signature)throw Error("Batch receipt mismatched");
    if(value.meta.err)return null;
    for(const valueNumber of [...value.meta.preBalances,...value.meta.postBalances,value.meta.fee])if(!Number.isSafeInteger(valueNumber)||valueNumber<0)throw Error("Unsafe batch receipt amount");
    return value;
  }
  const accountDelta=(value:Receipt,address:string)=>{
    const index=value.transaction.message.accountKeys.indexOf(address);
    if(index<0||value.meta.preBalances[index]===undefined||value.meta.postBalances[index]===undefined)throw Error("Batch receipt account missing");
    return BigInt(value.meta.postBalances[index]!)-BigInt(value.meta.preBalances[index]!);
  };
  async function status(signature:string){
    const value=(await ctx.connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    if(!value)return "unknown" as const;if(value.err)return "failed" as const;
    return value.confirmationStatus==="confirmed"||value.confirmationStatus==="finalized"?"confirmed" as const:"pending" as const;
  }
  async function compile(payer:string,signers:string[],instructions:TransactionInstruction[],cuLimit:number){
    const planned=await ctx.trader.compileGroups([{payer,additionalWallets:signers.filter(address=>address!==payer),drafts:[{instructions,signers:[],actions:[],trackedAccounts:[]}],cuLimit,priorityMicroLamports:0}]);
    if(planned.length!==1)throw Error("Batch must fit one atomic transaction");
    const plan=planned[0]!,bytes=plan.transaction.serialize();
    if(bytes.length>V1_PACKET_LIMIT)throw Error("Batch exceeds the transaction size limit");
    const wire=await loadWireTransaction();
    const decoded=wire.deserializeWireTransaction(bytes) as {signatures:Uint8Array[];message:{serialize():Uint8Array}};
    const feeResult=await rpc("getFeeForMessage",[Buffer.from(decoded.message.serialize()).toString("base64"),{commitment:"confirmed"}]) as {value:number|null};
    if(!Number.isSafeInteger(feeResult?.value)||feeResult.value===null||feeResult.value<0||BigInt(feeResult.value)>FEE_CAP)throw Error("Batch network fee exceeds its published execution cap");
    return {signed:{transaction:Buffer.from(bytes).toString("base64"),signature:bs58.encode(plan.transaction.signatures[0]!),lastValidBlockHeight:plan.lastValidBlockHeight},fee:BigInt(feeResult.value)};
  }
  const isReusedSigner=(state:UserBatchState)=>state.buyers[0]?.role==="signer";
  /** A pool signer's net SOL from this launch only: being funded at creation,
   * its column's buy, and the column's sale (all finalized receipts). */
  async function signerLedger(state:UserBatchState){
    const token=repo.tokens.getByMint(state.mint),intent=parseBundleIntent(token?.intent);
    const column=state.buyers[0]!.batchIndex??0;
    if(!intent||!state.sale)throw Error("Signer ledger needs the launch and sale receipts");
    let net=0n;
    for(const signature of [intent.signatures[0]!,intent.signatures[column+1]!,state.sale.signature]){
      const value=await receipt(signature);if(!value)throw Error("Signer ledger receipt is not finalized yet");
      net+=accountDelta(value,state.buyers[0]!.wallet);
    }
    if(net<0n)throw Error("Signer ledger is negative; payout requires review");
    return net;
  }
  return {
    sellFeeCap:FEE_CAP,settlementFeeCap:FEE_CAP,
    async fills(tokenId,batchIndex,state){
      const token=repo.tokens.get(tokenId),intent=parseBundleIntent(token?.intent);
      if(token?.status!=="live"||!intent)return null;
      const tranche=state.tranche!==undefined;
      if(tranche&&(!state.buy||!intent.fundingWallet))return null;
      const value=await receipt(tranche?state.buy!.signature:intent.signatures[batchIndex+1]!);if(!value)return null;
      // A tranche's deposit wallet funds its wallets in the same transaction and
      // pays its fee: those transfers net out and the fee joins the cost.
      let cost=tranche?-accountDelta(value,intent.fundingWallet!):0n;
      const fills=state.buyers.map(buyer=>{
        cost-=accountDelta(value,buyer.wallet);
        const amount=(rows:TokenBalance[]=[])=>rows.filter(row=>row.mint===state.mint&&row.owner===buyer.wallet).reduce((sum,row)=>sum+BigInt(row.uiTokenAmount.amount),0n);
        for(const balance of value.meta.postTokenBalances??[]){
          if(balance.owner!==buyer.wallet||balance.mint!==state.mint)continue;
          const rent=BigInt(value.meta.postBalances[balance.accountIndex]!)-BigInt(value.meta.preBalances[balance.accountIndex]!);
          if(rent>0n)cost-=rent; // refundable ATA rent is user principal, not buy cost
        }
        return amount(value.meta.postTokenBalances)-amount(value.meta.preTokenBalances);
      });
      return {fills,cost};
    },
    async marketCapUsd(mint){
      const plugin=await pump(),context={connection:ctx.connection,token:await loadToken(mint),user:new PublicKey(mint)};
      const market=await plugin.resolveMarket(context);
      const reserves=market?.metadata?.curve??market?.metadata?.reserves;
      if(!market||market.quoteAsset.kind!=="native-sol"||!reserves||reserves.virtualBase<=0n)throw Error("Market cap needs a native SOL Pump market");
      const supply=(await getMint(ctx.connection,new PublicKey(mint),"confirmed",market.baseTokenProgram)).supply;
      return Number(reserves.virtualQuote*supply/reserves.virtualBase)/1e9*await solUsd();
    },
    async prepareTrancheBuy(tokenId,state){
      const intent=parseBundleIntent(repo.tokens.get(tokenId)?.intent);
      if(!intent?.fundingWallet||state.tranche===undefined||!("trigger" in state.config))throw Error("Tranche buy needs the launch's deposit wallet");
      const deposit=new PublicKey(intent.fundingWallet),plugin=await pump(),token=await loadToken(state.mint);
      const coreName:string="@solard/core";
      const core=await import(coreName) as {rawAmount(raw:bigint):{raw:bigint;asset:unknown}};
      const instructions:TransactionInstruction[]=[];
      let market:Market|null=null;
      for(const buyer of state.buyers){
        const owner=new PublicKey(buyer.wallet),budget=BigInt(buyer.budgetLamports);
        const context={connection:ctx.connection,token,user:owner};
        market??=await plugin.resolveMarket(context);
        if(!market||market.quoteAsset.kind!=="native-sol")throw Error("Tranche requires a native SOL Pump market");
        instructions.push(SystemProgram.transfer({fromPubkey:deposit,toPubkey:owner,lamports:budget+BigInt(BUYER_RESERVE_LAMPORTS)}));
        const quote=await plugin.quoteBuy(context,market,core.rawAmount(budget),state.config.slippageBps);
        instructions.push(...(await plugin.buildBuy(context,market,quote)).instructions);
        // The next wallet buys after this one: quote it on the moved reserves.
        const reserves=market.metadata?.curve??market.metadata?.reserves;
        if(!reserves)throw Error("Tranche market reserves are unavailable");
        reserves.virtualQuote+=budget;reserves.virtualBase-=quote.expectedOutputRaw;
      }
      return (await compile(intent.fundingWallet,[intent.fundingWallet,...state.buyers.map(b=>b.wallet)],instructions,1_400_000)).signed;
    },
    async prepareSale(state,requiredOutput,floorUsd){
      const moduleName:string="@solard/core/venues/pump/pump-plugin.ts";
      const {PumpPlugin}=await import(moduleName) as {PumpPlugin:new()=>Plugin};
      const sellers=saleBuyers(state);
      const plugin=new PumpPlugin(),seller=sellers[0]!.wallet,mint=new PublicKey(state.mint);
      const context={connection:ctx.connection,token:await loadToken(state.mint),user:new PublicKey(seller)};
      const market=await plugin.resolveMarket(context);
      if(!market||market.quoteAsset.kind!=="native-sol")throw Error("Batch requires a native SOL Pump market");
      const metadata=await getMint(ctx.connection,mint,"confirmed",market.baseTokenProgram);
      const sellerAccount=getAssociatedTokenAddressSync(mint,new PublicKey(seller),false,market.baseTokenProgram);
      const instructions:TransactionInstruction[]=[];
      // A forced sale (admin finalize / liquidate) sells what each wallet still
      // holds, up to its recorded fill: a wallet may have sold on its own.
      const held=async(wallet:string)=>{
        const balance=await ctx.connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint,new PublicKey(wallet),false,market.baseTokenProgram),"confirmed").catch(()=>null);
        return balance?BigInt(balance.value.amount):0n;
      };
      if(state.forced)instructions.push(createAssociatedTokenAccountIdempotentInstruction(new PublicKey(seller),sellerAccount,new PublicKey(seller),mint,market.baseTokenProgram));
      let total=0n;
      for(const buyer of sellers){
        const recorded=BigInt(state.fills[state.buyers.indexOf(buyer)]!);
        const fill=state.forced?(await held(buyer.wallet)<recorded?await held(buyer.wallet):recorded):recorded;
        total+=fill;
        if(buyer.wallet!==seller&&fill>0n)instructions.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint,new PublicKey(buyer.wallet),false,market.baseTokenProgram),mint,sellerAccount,new PublicKey(buyer.wallet),fill,metadata.decimals,[],market.baseTokenProgram));
      }
      if(total===0n)throw Error("Nothing left to sell in this column");
      const limited=requiredOutput!==null||floorUsd!==undefined;
      const quote=await plugin.quoteSell(context,market,total,limited?0:500);
      let minimumOutput=requiredOutput;
      if(floorUsd!==undefined){
        const reserves=market.metadata?.curve??market.metadata?.reserves;
        if(!reserves)throw Error("Floor sale needs the market's reserves");
        minimumOutput=floorSaleMinimum({...reserves,supply:metadata.supply,sellRaw:total,floorLamports:floorUsd/await solUsd()*1e9});
        if(minimumOutput===null)throw Error("This sale is too large to clear its market cap floor");
      }
      if(minimumOutput!==null){quote.minimumOutputRaw=minimumOutput;quote.meta={...quote.meta,absoluteMinimumOutputRaw:String(minimumOutput),preparedLimitOrder:true};}
      const built=await plugin.buildSell(context,market,quote);
      if(minimumOutput!==null&&(built.minOutputRaw===undefined||built.minOutputRaw<minimumOutput))throw Error("Venue did not enforce the combined batch minimum");
      const {signed}=await compile(seller,sellers.map(buyer=>buyer.wallet),[...instructions,...built.instructions],600_000);
      return signed;
    },
    needsRefresh:async height=>(await ctx.connection.getBlockHeight("confirmed"))>=height-20,
    simulate:transaction=>simulateRaw(ctx.rpcUrl,Buffer.from(transaction,"base64"),true),
    async send(transaction){await ctx.connection.sendRawTransaction(Buffer.from(transaction,"base64"),{skipPreflight:true,maxRetries:0});},
    status,
    async failedFee(signature){
      const value=await finalizedTransaction(signature);
      if(!value?.meta||value.transaction.signatures[0]!==signature||!value.meta.err)return null;
      if(!Number.isSafeInteger(value.meta.fee)||value.meta.fee<0||BigInt(value.meta.fee)>FEE_CAP)throw Error("Unsafe failed batch fee");
      return BigInt(value.meta.fee);
    },
    async absentAfterExpiry(signature,height){
      if(await ctx.connection.getBlockHeight("finalized")<=height)return false;
      if(await status(signature)!=="unknown")return false;
      return await rpc("getTransaction",[signature,{encoding:"json",commitment:"finalized",maxSupportedTransactionVersion:1}])===null;
    },
    async saleReceipt(state){
      if(!state.sale)throw Error("Batch sale signature missing");
      const value=await receipt(state.sale.signature);if(!value)return null;
      // A ladder sale holds only the wallet it sold.
      return state.buyers.filter(buyer=>value.transaction.message.accountKeys.includes(buyer.wallet)).reduce((sum,buyer)=>sum+accountDelta(value,buyer.wallet),0n);
    },
    async preparePayout(state){
      const payer=state.buyers[0]!.wallet,destination=new PublicKey(state.proceedsWallet),mint=new PublicKey(state.mint);
      if(state.buyers.some(buyer=>buyer.wallet===state.proceedsWallet))throw Error("Proceeds destination must be outside the buyer batch");
      const reused=isReusedSigner(state);
      const ledger=reused?await signerLedger(state):null;
      const mintInfo=await ctx.connection.getAccountInfo(mint,"confirmed");if(!mintInfo)throw Error("Mint is unavailable");
      const instructions:TransactionInstruction[]=[],balances=new Map<string,bigint>();
      // Rent of a token account a reused signer keeps open: it holds the signer's
      // own tokens of this coin (bought outside the launch), so instead of closing
      // it the signer pays its rent deposit from its own SOL.
      let keptRent=0n;
      for(const buyer of state.buyers){
        balances.set(buyer.wallet,BigInt(await ctx.connection.getBalance(new PublicKey(buyer.wallet),"confirmed")));
        const accounts=await ctx.connection.getParsedTokenAccountsByOwner(new PublicKey(buyer.wallet),{mint},"confirmed");
        for(const account of accounts.value){
          if(BigInt(account.account.data.parsed.info.tokenAmount.amount)!==0n){
            if(!(reused&&buyer.wallet===payer))throw Error("Batch has tokens remaining; payout requires review");
            keptRent+=BigInt(account.account.lamports);continue;
          }
          instructions.push(createCloseAccountInstruction(account.pubkey,destination,new PublicKey(buyer.wallet),[],mintInfo.owner));
        }
      }
      const make=(fee:bigint)=>[...instructions,...state.buyers.map(buyer=>{
        // A reused pool signer sends only this launch's own net flows.
        const owned=reused&&buyer.wallet===payer?ledger!+keptRent:balances.get(buyer.wallet)!;
        if(owned>balances.get(buyer.wallet)!)throw Error("Signer holds less than this launch's recorded flows; payout requires review");
        const available=owned-(buyer.wallet===payer?fee:0n);
        if(available<0n)throw Error("Batch payout cannot cover network fee");
        return SystemProgram.transfer({fromPubkey:new PublicKey(buyer.wallet),toPubkey:destination,lamports:available});
      })];
      const estimate=await compile(payer,state.buyers.map(buyer=>buyer.wallet),make(FEE_CAP),250_000);
      const exact=await compile(payer,state.buyers.map(buyer=>buyer.wallet),make(estimate.fee),250_000);
      if(exact.fee!==estimate.fee)throw Error("Batch payout fee changed during preparation");
      const problem=await simulateRaw(ctx.rpcUrl,Buffer.from(exact.signed.transaction,"base64"),true);if(problem)throw Error("Batch payout simulation failed: "+problem.slice(0,120));
      return exact.signed;
    },
    async payoutReceipt(state){
      if(!state.payout)throw Error("Batch payout signature missing");
      const value=await receipt(state.payout.signature);if(!value)return null;
      for(const [i,buyer] of state.buyers.entries()){
        if(i===0&&isReusedSigner(state))continue; // the pool signer keeps its own funds
        const index=value.transaction.message.accountKeys.indexOf(buyer.wallet);if(index<0||value.meta.postBalances[index]!==0)throw Error("Batch payout left funds in a buyer wallet");
      }
      return accountDelta(value,state.proceedsWallet);
    },
    liquidation:{
      async holdings(wallet,mint){
        const accounts=await ctx.connection.getParsedTokenAccountsByOwner(new PublicKey(wallet),{mint:new PublicKey(mint)},"confirmed");
        return {amount:accounts.value.reduce((sum,a)=>sum+BigInt(a.account.data.parsed.info.tokenAmount.amount),0n),accounts:accounts.value.length};
      },
      async prepareSale(mint,payer,sales){
        const moduleName:string="@solard/core/venues/pump/pump-plugin.ts";
        const {PumpPlugin}=await import(moduleName) as {PumpPlugin:new()=>Plugin};
        const plugin=new PumpPlugin(),token=await loadToken(mint),mintKey=new PublicKey(mint);
        const mintInfo=await ctx.connection.getAccountInfo(mintKey,"confirmed");if(!mintInfo)throw Error("Mint is unavailable");
        const instructions:TransactionInstruction[]=[];
        for(const sale of sales){
          const owner=new PublicKey(sale.wallet);
          if(sale.amount>0n){
            const context={connection:ctx.connection,token,user:owner};
            const market=await plugin.resolveMarket(context);
            if(!market||market.quoteAsset.kind!=="native-sol")throw Error("Liquidation requires a native SOL Pump market");
            // At market: the sells in this transaction move the price for each
            // other, so each accepts anything above 1% of its own quote.
            const quote=await plugin.quoteSell(context,market,sale.amount,9_900);
            instructions.push(...(await plugin.buildSell(context,market,quote)).instructions);
          }
          if(sale.close)for(const account of (await ctx.connection.getTokenAccountsByOwner(owner,{mint:mintKey},"confirmed")).value)
            instructions.push(createCloseAccountInstruction(account.pubkey,owner,owner,[],mintInfo.owner));
        }
        const wallets=[payer,...sales.map(sale=>sale.wallet).filter(wallet=>wallet!==payer)];
        return (await compile(payer,wallets,instructions,1_400_000)).signed;
      },
      async prepareSweep(wallet,to){
        const balance=BigInt(await ctx.connection.getBalance(new PublicKey(wallet),"confirmed"));
        const make=(fee:bigint)=>[SystemProgram.transfer({fromPubkey:new PublicKey(wallet),toPubkey:new PublicKey(to),lamports:balance-fee})];
        if(balance<=FEE_CAP)return null;
        const estimate=await compile(wallet,[wallet],make(FEE_CAP),5_000);
        if(balance<=estimate.fee)return null;
        const exact=await compile(wallet,[wallet],make(estimate.fee),5_000);
        if(exact.fee!==estimate.fee)throw Error("Sweep fee changed during preparation");
        return exact.signed;
      },
      expired:async height=>(await ctx.connection.getBlockHeight("finalized"))>height,
      simulate:transaction=>simulateRaw(ctx.rpcUrl,Buffer.from(transaction,"base64"),true),
      async send(transaction){await ctx.connection.sendRawTransaction(Buffer.from(transaction,"base64"),{skipPreflight:true,maxRetries:0});},
      status,
    },
  };
}
