import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { repairKnownLedgerIncidents } from "./lib/signal-log.mjs";

function csvCell(value:any){
  if(value === null || value === undefined) return "";
  const s=String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mcl-engine");
  const rawSaved:any=await s.get("signal-log",{type:"json"}) || {trades:[]};
  const repaired=repairKnownLedgerIncidents(rawSaved);
  const saved:any=repaired.ledger;
  if(repaired.repaired) await s.setJSON("signal-log",saved);
  const trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  const rows=[...trades].reverse();
  const headers=[
    "trade_number","id","strategy_version","status","direction","contract","source_contract","opened_at","entry_price","entry_score","entry_signal","entry_raw_signal","entry_reason","entry_raw_reason","alignment","daily_state",
    "closed_at","exit_price","exit_score","exit_signal","exit_raw_signal","exit_reason","exit_raw_reason","points","theoretical_pnl","round_trip_fees","net_pnl_before_slippage","duration_minutes","shadow_mfe_points","shadow_mae_points","shadow_stop_touched","shadow_stop_price","shadow_first_stop_touch_at","shadow_last_bar_high","shadow_last_bar_low","eligible_for_stats","audit_status","void_reason","reconstruction_reason"
  ];
  const lines=[headers.join(",")];
  for(let i=0;i<rows.length;i++){
    const t=rows[i];
    const values=[
      t.tradeNumber ?? (i+1),t.id,t.strategyVersion,t.status,t.direction,t.contract,t.sourceContract,t.openedAt,t.entryPrice,t.entryScore,t.entrySignal,t.entryRawSignal,t.entryReason,t.entryRawReason,t.alignment,t.dailyState,
      t.closedAt,t.exitPrice,t.exitScore,t.exitSignal,t.exitRawSignal,t.exitReason,t.exitRawReason,t.points,t.theoreticalPnl,t.roundTripFees,t.netPnlBeforeSlippage,t.durationMinutes,t.shadowMfePoints,t.shadowMaePoints,t.shadowStopTouched ?? false,t.shadowStopPrice,t.shadowFirstStopTouchAt,t.shadowLastBarHigh,t.shadowLastBarLow,t.eligibleForStats ?? true,t.auditStatus,t.voidReason,t.reconstructionReason
    ];
    lines.push(values.map(csvCell).join(","));
  }
  const day=new Date().toISOString().slice(0,10);
  return new Response(lines.join("\n")+"\n",{
    headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="wtc-mcl-trade-log-${day}.csv"`,
      "Cache-Control":"no-store"
    }
  });
};

export const config:Config={path:"/api/signal-log.csv"};
