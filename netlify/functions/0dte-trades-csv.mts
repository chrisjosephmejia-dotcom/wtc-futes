import type { Context, Config } from "@netlify/functions";
import { get0DteStore } from "./lib/0dte-store.mts";

function csvCell(v:any){
  if(v===null||v===undefined)return "";
  const s=typeof v==="object"?JSON.stringify(v):String(v);
  return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}

export default async(_req:Request,_ctx:Context)=>{
  try{
    const store=get0DteStore(),trades=(await store.get("trades/index.json",{type:"json"}).catch(()=>null))||[];
    const cols=[
      "id","version","date","direction","setup","contract","strike","expiration","optionType",
      "entryTime","exitTime","durationMin","entrySpy","exitSpy","entryXsp","exitXsp",
      "entryBid","entryAsk","entryMid","exitBid","exitAsk","exitMid",
      "pnlDollars","pnlPct","midPnlDollars","midPnlPct","mfePct","maePct",
      "entryScore","exitScore","exitReason","closedAt"
    ];
    const rows=[cols.join(","),...trades.map((t:any)=>cols.map(k=>csvCell(t?.[k])).join(","))];
    return new Response(rows.join("\n"),{headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":'attachment; filename="wtc-xsp-0dte-trades.csv"',
      "Cache-Control":"no-store"
    }});
  }catch(e:any){
    return new Response(e?.message||String(e),{status:503});
  }
};

export const config:Config={path:"/api/0dte-trades.csv"};
