import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";

function csvCell(value:any){
  if(value === null || value === undefined) return "";
  const s=String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mnq-engine");
  const saved:any=await s.get("signal-log",{type:"json"}) || {trades:[]};
  const trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  const rows=[...trades].reverse();
  const headers=[
    "id","status","direction","contract","source_contract","opened_at","entry_price","entry_score","entry_reason","alignment",
    "closed_at","exit_price","exit_signal","exit_reason","points","theoretical_pnl","duration_minutes"
  ];
  const lines=[headers.join(",")];
  for(const t of rows){
    const values=[
      t.id,t.status,t.direction,t.contract,t.sourceContract,t.openedAt,t.entryPrice,t.entryScore,t.entryReason,t.alignment,
      t.closedAt,t.exitPrice,t.exitSignal,t.exitReason,t.points,t.theoreticalPnl,t.durationMinutes
    ];
    lines.push(values.map(csvCell).join(","));
  }
  const day=new Date().toISOString().slice(0,10);
  return new Response(lines.join("\n")+"\n",{
    headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="wtc-mnq-signal-log-${day}.csv"`,
      "Cache-Control":"no-store"
    }
  });
};

export const config:Config={path:"/api/signal-log.csv"};
