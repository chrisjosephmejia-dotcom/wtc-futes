import type { Context, Config } from "@netlify/functions";
import { get0DteStore } from "./lib/0dte-store.mts";

function csvCell(v:any){
  if(v===null||v===undefined)return "";
  const s=typeof v==="object"?JSON.stringify(v):String(v);
  return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function ctDate(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o:any={};p.forEach(x=>o[x.type]=x.value);return `${o.year}-${o.month}-${o.day}`;
}
function flat(r:any){
  return {
    minuteKey:r.minuteKey,timestamp:r.timestamp,date:r.date,rawSignal:r.rawSignal,directionalRaw:r.directionalRaw,
    headline:r.headline,positionState:r.positionState,score:r.score,trigger:r.trigger,
    spyPrice:r.spy?.price,spyVwap:r.spy?.vwap,spyVwapPct:r.spy?.vwapPct,spyOrState:r.spy?.orState,
    spyRsi5:r.spy?.rsi5,spyMomentum1:r.spy?.momentum1,m5:r.timeframes?.m5?.state,m15:r.timeframes?.m15?.state,
    qqqFromOpen:r.confirmations?.qqqFromOpen,iwmFromOpen:r.confirmations?.iwmFromOpen,vixFromOpen:r.confirmations?.vixFromOpen,
    esPrice:r.confirmations?.es?.price,esVwapPct:r.confirmations?.es?.vwapPct,esTrend5:r.confirmations?.es?.trend5,esOvernightLocation:r.confirmations?.es?.overnightLocation,
    chop:r.chop,eventLockout:r.eventLockout,blockReason:r.blockReason,optionSymbol:r.optionSymbol,
    optionBid:r.optionBid,optionAsk:r.optionAsk,modelPnlPct:r.modelPnlPct,action:r.action?.type||null,actionReason:r.action?.reason||null
  };
}

export default async(req:Request,_ctx:Context)=>{
  try{
    const store=get0DteStore(),u=new URL(req.url),all=u.searchParams.get("all")==="1",date=u.searchParams.get("date")||ctDate();
    let rows:any[]=[];
    if(all){
      const listed:any=await store.list({prefix:"raw/"});
      const keys=(listed?.blobs||[]).map((x:any)=>x.key).filter((k:string)=>k.endsWith(".json")).sort();
      for(const k of keys){const x=await store.get(k,{type:"json"}).catch(()=>null);if(Array.isArray(x))rows.push(...x)}
    }else{
      const x=await store.get(`raw/${date}.json`,{type:"json"}).catch(()=>null);if(Array.isArray(x))rows=x;
    }
    const xs=rows.map(flat),cols=[
      "minuteKey","timestamp","date","rawSignal","directionalRaw","headline","positionState","score","trigger",
      "spyPrice","spyVwap","spyVwapPct","spyOrState","spyRsi5","spyMomentum1","m5","m15",
      "qqqFromOpen","iwmFromOpen","vixFromOpen","esPrice","esVwapPct","esTrend5","esOvernightLocation","chop","eventLockout","blockReason",
      "optionSymbol","optionBid","optionAsk","modelPnlPct","action","actionReason"
    ];
    const out=[cols.join(","),...xs.map((r:any)=>cols.map(k=>csvCell(r[k])).join(","))].join("\n");
    const suffix=all?"all":date;
    return new Response(out,{headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="wtc-xsp-0dte-raw-${suffix}.csv"`,
      "Cache-Control":"no-store"
    }});
  }catch(e:any){return new Response(e?.message||String(e),{status:503})}
};

export const config:Config={path:"/api/0dte-raw.csv"};
