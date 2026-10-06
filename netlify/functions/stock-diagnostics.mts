import type { Context, Config } from "@netlify/functions";
import { accessToken, getEquityBars } from "./lib/equity-data.mts";

const BASE="https://api.tastyworks.com",UA="wtc-stock-trader/1.0";

export default async(req:Request,_ctx:Context)=>{
  const u=new URL(req.url),ticker=(u.searchParams.get("ticker")||"PL").trim().toUpperCase();
  const steps:any={};
  let token="";
  try{
    token=await accessToken();
    steps.oauth={ok:true};
  }catch(e:any){
    steps.oauth={ok:false,error:e?.message||String(e)};
    return Response.json({ok:false,ticker,steps,checkedAt:new Date().toISOString()},{status:503,headers:{"Cache-Control":"no-store"}});
  }

  try{
    const q=new URL(`${BASE}/market-data/by-type`);
    q.searchParams.append("equity[]",ticker);
    const r=await fetch(q,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
    const body:any=await r.json().catch(()=>({}));
    const x=body?.data?.items?.[0]||null;
    steps.restQuote={ok:Boolean(r.ok&&x),httpStatus:r.status,symbol:x?.symbol||ticker,hasBid:x?.bid!=null,hasAsk:x?.ask!=null,hasLast:x?.last!=null};
    if(!r.ok||!x) steps.restQuote.error=body?.error?.message||body?.message||"quote unavailable";
  }catch(e:any){steps.restQuote={ok:false,error:e?.message||String(e)}}

  try{
    const d=await getEquityBars(ticker);
    steps.dxlink={ok:true,streamerSymbol:d.streamerSymbol,minuteBars:d.minuteBars.length,dailyBars:d.dailyBars.length,lastMinute:d.minuteBars.at(-1)?.t||null,lastDaily:d.dailyBars.at(-1)?.t||null};
  }catch(e:any){steps.dxlink={ok:false,error:e?.message||String(e)}}

  const ok=Boolean(steps.oauth?.ok&&steps.restQuote?.ok&&steps.dxlink?.ok);
  return Response.json({ok,ticker,steps,checkedAt:new Date().toISOString()},{status:ok?200:503,headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/stock-diagnostics"};
