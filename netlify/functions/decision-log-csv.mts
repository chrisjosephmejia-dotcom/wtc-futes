import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";

function csvCell(value:any){
  if(value === null || value === undefined) return "";
  const s=String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export default async (req:Request,_context:Context) => {
  const s=store("mnq-engine");
  const url=new URL(req.url);
  const requested=url.searchParams.get("date");
  const all=url.searchParams.get("all") === "1";
  const listed:any=await s.list({prefix:"decision-log/"});
  const keys=(listed.blobs||[]).map((b:any)=>b.key).sort();
  let selected:string[]=[];
  if(all) selected=keys;
  else if(requested) selected=keys.filter((k:string)=>k===`decision-log/${requested}`);
  else if(keys.length) selected=[keys[keys.length-1]];

  const headers=[
    "checked_at","strategy_version","source_contract","price","score","raw_signal","raw_reason","position_signal","position_event","position_reason","daily_state","frame_30m","frame_15m","frame_5m","frame_1m","vwap","feed_active","session","in_entry","extension_blocked"
  ];
  const lines=[headers.join(",")];
  for(const key of selected){
    const saved:any=await s.get(key,{type:"json"}) || {};
    for(const e of (Array.isArray(saved.entries)?saved.entries:[])){
      const values=[e.checkedAt,e.strategyVersion,e.sourceContract,e.price,e.score,e.rawSignal,e.rawReason,e.positionSignal,e.positionEvent,e.positionReason,e.dailyState,e.frame30,e.frame15,e.frame5,e.frame1,e.vwap,e.feedActive,e.session,e.inEntry,e.extensionBlocked];
      lines.push(values.map(csvCell).join(","));
    }
  }
  const suffix=all?"all":requested||selected[0]?.split("/").pop()||"empty";
  return new Response(lines.join("\n")+"\n",{
    headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="wtc-mnq-v2-decision-log-${suffix}.csv"`,
      "Cache-Control":"no-store"
    }
  });
};

export const config:Config={path:"/api/decision-log.csv"};
