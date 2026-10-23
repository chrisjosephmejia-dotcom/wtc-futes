import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";

function csvCell(value:any){
  if(value === null || value === undefined) return "";
  const s=String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export default async (req:Request,_context:Context) => {
  const s=store("mcl-engine");
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
    "checked_at","strategy_version","source_contract","price","score","raw_signal","raw_reason","position_signal","position_event","position_reason","daily_state","frame_30m","frame_15m","frame_5m","frame_1m","vwap","feed_active","session","in_entry","extension_blocked","risk_open_points","risk_take_profit_points","risk_trigger","risk_lock_direction","risk_lock_active","shadow_stop_touched","shadow_stop_price","shadow_bar_mfe_points","shadow_bar_mae_points","shadow_bar_high","shadow_bar_low","engine_error","source","open","opening_range_low","opening_range_high","threshold_buy","threshold_sell","extension_pct","extension_limit_pct","daily_rsi","daily_ema20","daily_ema50","frame_30m_score","frame_30m_rsi","frame_30m_ema","frame_30m_macd","frame_30m_move","frame_15m_score","frame_15m_rsi","frame_15m_ema","frame_15m_macd","frame_15m_move","frame_5m_score","frame_5m_rsi","frame_5m_ema","frame_5m_macd","frame_5m_move","frame_1m_score","frame_1m_rsi","frame_1m_ema","frame_1m_macd","frame_1m_move","last_bar","last_bar_label","age_sec","minute_bars","daily_bars"
  ];
  const lines=[headers.join(",")];
  for(const key of selected){
    const saved:any=await s.get(key,{type:"json"}) || {};
    for(const e of (Array.isArray(saved.entries)?saved.entries:[])){
      const values=[e.checkedAt,e.strategyVersion,e.sourceContract,e.price,e.score,e.rawSignal,e.rawReason,e.positionSignal,e.positionEvent,e.positionReason,e.dailyState,e.frame30,e.frame15,e.frame5,e.frame1,e.vwap,e.feedActive,e.session,e.inEntry,e.extensionBlocked,e.riskCap?.openPoints,e.riskCap?.takeProfitPoints,e.riskCap?.trigger,e.riskCap?.lockDirection,e.riskCap?.lockActive,e.shadowStopTouched,e.shadowStopPrice,e.shadowBarMfePoints,e.shadowBarMaePoints,e.shadowBarHigh,e.shadowBarLow,e.engineError,e.source,e.open,e.openingRangeLow,e.openingRangeHigh,e.thresholdBuy,e.thresholdSell,e.extensionPct,e.extensionLimitPct,e.dailyRsi,e.dailyEma20,e.dailyEma50,e.frame30Detail?.score,e.frame30Detail?.rsi,e.frame30Detail?.ema,e.frame30Detail?.macd,e.frame30Detail?.move,e.frame15Detail?.score,e.frame15Detail?.rsi,e.frame15Detail?.ema,e.frame15Detail?.macd,e.frame15Detail?.move,e.frame5Detail?.score,e.frame5Detail?.rsi,e.frame5Detail?.ema,e.frame5Detail?.macd,e.frame5Detail?.move,e.frame1Detail?.score,e.frame1Detail?.rsi,e.frame1Detail?.ema,e.frame1Detail?.macd,e.frame1Detail?.move,e.lastBar,e.lastBarLabel,e.ageSec,e.minuteBars,e.dailyBars];
      lines.push(values.map(csvCell).join(","));
    }
  }
  const suffix=all?"all":requested||selected[0]?.split("/").pop()||"empty";
  return new Response(lines.join("\n")+"\n",{
    headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="wtc-mcl-decision-log-${suffix}.csv"`,
      "Cache-Control":"no-store"
    }
  });
};

export const config:Config={path:"/api/decision-log.csv"};
