import type { Context, Config } from "@netlify/functions";
import { get0DteStore } from "./lib/0dte-store.mts";
import { pushSubscriberCount } from "./lib/push.mts";

function stats(trades:any[]){
  const xs=trades||[];let cum=0,peak=0,maxDd=0,gp=0,gl=0;
  for(const t of xs){const p=Number(t.pnlDollars)||0;cum+=p;peak=Math.max(peak,cum);maxDd=Math.max(maxDd,peak-cum);if(p>0)gp+=p;else gl+=Math.abs(p)}
  const wins=xs.filter(t=>(Number(t.pnlDollars)||0)>0).length,total=xs.reduce((a,t)=>a+(Number(t.pnlDollars)||0),0);
  const calls=xs.filter(t=>t.direction==="CALL"),puts=xs.filter(t=>t.direction==="PUT");
  const sum=(a:any[])=>a.reduce((x,t)=>x+(Number(t.pnlDollars)||0),0);
  return {
    trades:xs.length,wins,winRate:xs.length?wins/xs.length*100:0,totalPnl:total,avgPnl:xs.length?total/xs.length:0,
    profitFactor:gl?gp/gl:gp?Infinity:0,maxDrawdown:maxDd,
    calls:{trades:calls.length,pnl:sum(calls)},puts:{trades:puts.length,pnl:sum(puts)}
  };
}

export default async(_req:Request,_ctx:Context)=>{
  try{
    const store=get0DteStore();
    const [status,trades,subscribers]=await Promise.all([
      store.get("status/current.json",{type:"json"}).catch(()=>null),
      store.get("trades/index.json",{type:"json"}).catch(()=>null),
      pushSubscriberCount().catch(()=>0)
    ]);
    const ledger=Array.isArray(trades)?trades:[];
    return Response.json({
      ok:true,
      status:status||{ok:true,version:"WTC XSP 0DTE V1",headline:"INITIALIZING"},
      pushSubscribers:subscribers,
      performance:stats(ledger),
      recentTrades:ledger.slice(-25).reverse()
    },{headers:{"Cache-Control":"no-store"}});
  }catch(e:any){
    return Response.json({ok:false,error:e?.message||String(e)},{status:503,headers:{"Cache-Control":"no-store"}});
  }
};

export const config:Config={path:"/api/0dte-status"};