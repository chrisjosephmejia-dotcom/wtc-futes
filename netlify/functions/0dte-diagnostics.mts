import type { Context, Config } from "@netlify/functions";
import { tastyAccessToken, getMarketSnapshot, getSameDayXspContracts } from "./lib/tasty-0dte.mts";
import { getEquityFastContext } from "./lib/equity-data.mts";
import { getFutureFastContext } from "./lib/future-data.mts";

async function step(name:string,fn:()=>Promise<any>){
  const started=Date.now();
  try{
    const value=await fn();
    return {name,ok:true,ms:Date.now()-started,value};
  }catch(error:any){
    return {name,ok:false,ms:Date.now()-started,error:error?.message||String(error)};
  }
}

export default async(_req:Request,_ctx:Context)=>{
  const auth=await step("oauth",async()=>({token:await tastyAccessToken()}));
  if(!auth.ok)return Response.json({ok:false,steps:[auth]},{headers:{"Cache-Control":"no-store"}});
  const token=auth.value.token as string;

  const [spy,snapshot,es,chain]=await Promise.all([
    step("spy-dxlink",async()=>{
      const x=await getEquityFastContext("SPY",token);
      return {minuteBars:x.minuteBars.length,dailyBars:x.dailyBars.length,lastMinute:x.minuteBars.at(-1)?.t||null,streamerSymbol:x.streamerSymbol};
    }),
    step("rest-quotes",async()=>{
      const x=await getMarketSnapshot(token);
      return {symbols:Object.keys(x.quotes),health:x.health};
    }),
    step("es-dxlink",async()=>{
      const x=await getFutureFastContext("ES",token);
      return {symbol:x.symbol,minuteBars:x.minuteBars.length,lastMinute:x.minuteBars.at(-1)?.t||null};
    }),
    step("xsp-chain",async()=>{
      const x=await getSameDayXspContracts(token);
      return {contracts:x.length,sample:x.slice(0,4).map(y=>({strike:y.strike,type:y.optionType,expiration:y.expiration}))};
    })
  ]);

  return Response.json({
    ok:spy.ok,
    checkedAt:new Date().toISOString(),
    note:"No credentials or access tokens are returned.",
    steps:[
      {name:"oauth",ok:true,ms:auth.ms},
      spy,snapshot,es,chain
    ]
  },{headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/0dte-diagnostics"};
