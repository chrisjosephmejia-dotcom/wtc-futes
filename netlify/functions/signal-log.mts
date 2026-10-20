import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { MNQ_DOLLARS_PER_POINT, ROBINHOOD_ROUND_TRIP_FEE, V3_START_TRADE_NUMBER, V4_START_TRADE_NUMBER, theoreticalMark, repairKnownLedgerIncidents } from "./lib/signal-log.mjs";
import { STRATEGY_VERSION } from "./lib/position-state.mjs";

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mnq-engine");
  const rawSaved:any=await s.get("signal-log",{type:"json"}) || {trades:[],strategyVersion:STRATEGY_VERSION};
  const repaired=repairKnownLedgerIncidents(rawSaved);
  const saved:any=repaired.ledger;
  if(repaired.repaired) await s.setJSON("signal-log",saved);
  const status:any=await s.get("status",{type:"json"}) || {};
  const trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  const closed=trades.filter(t=>t?.status === "CLOSED" && t?.eligibleForStats !== false && t?.theoreticalPnl !== null && t?.theoreticalPnl !== undefined && Number.isFinite(Number(t?.theoreticalPnl)));
  const open=trades.find(t=>t?.status === "OPEN") || null;
  const openMark=open?theoreticalMark(open,status?.price):null;
  const closedPnl=round(closed.reduce((sum,t)=>sum+Number(t.theoreticalPnl||0),0),2);
  const totalFees=round(closed.reduce((sum,t)=>sum+Number(t.roundTripFees ?? ROBINHOOD_ROUND_TRIP_FEE),0),2);
  const closedNetPnl=round(closed.reduce((sum,t)=>sum+Number(t.netPnlBeforeSlippage ?? (Number(t.theoreticalPnl||0)-ROBINHOOD_ROUND_TRIP_FEE)),0),2);
  const wins=closed.filter(t=>Number(t.theoreticalPnl)>0).length;
  const losses=closed.filter(t=>Number(t.theoreticalPnl)<0).length;
  const flats=closed.length-wins-losses;
  const totalPoints=round(closed.reduce((sum,t)=>sum+Number(t.points||0),0),2);

  const rows=trades.slice(0,25).map(t=>{
    if(t?.status !== "OPEN") return t;
    return {
      ...t,
      markPrice:Number.isFinite(Number(status?.price))?Number(status.price):null,
      points:openMark?.points ?? null,
      theoreticalPnl:openMark?.theoreticalPnl ?? null,
      netPnlBeforeSlippage:openMark?.netPnlBeforeSlippage ?? null,
    };
  });

  return Response.json({
    strategyVersion:saved.strategyVersion || STRATEGY_VERSION,
    createdAt:saved.createdAt || null,
    updatedAt:saved.updatedAt || null,
    retention:"permanent",
    v3StartTradeNumber:V3_START_TRADE_NUMBER,
    v4StartTradeNumber:V4_START_TRADE_NUMBER,
    displayLimit:25,
    totalStoredTrades:trades.length,
    voidTrades:trades.filter(t=>t?.status === "VOID").length,
    multiplier:MNQ_DOLLARS_PER_POINT,
    basis:"1 MNQ contract",
    feeModel:{provider:"Robinhood Gold",roundTrip:ROBINHOOD_ROUND_TRIP_FEE},
    riskModel:saved.riskModel || null,
    downloadUrl:"/api/signal-log.csv",
    rawDecisionDownloadUrl:"/api/decision-log.csv",
    stats:{
      closedTrades:closed.length,
      wins,
      losses,
      flats,
      winRate:closed.length?round((wins/closed.length)*100,1):null,
      closedPoints:totalPoints,
      closedPnl,
      totalFees,
      closedNetPnlBeforeSlippage:closedNetPnl,
      openPnl:openMark?.theoreticalPnl ?? null,
      openNetPnlBeforeSlippage:openMark?.netPnlBeforeSlippage ?? null,
      openPoints:openMark?.points ?? null,
    },
    trades:rows,
    note:`${STRATEGY_VERSION}. Trades 1-46 remain V2; trades 47-103 remain frozen V3; trade 104 onward is V4. Trade 57 was reconstructed as the continuous official position after the 2026-10-11 stale-feed defect; trades 58-62 are retained as VOID audit records and excluded from all performance statistics. V4 keeps the -25 point (-$50 gross) hard stop and the existing score-zero/reversal lifecycle exits, with no fixed take-profit for any trade so winners can run. After a hard risk exit, same-direction re-entry is blocked until the original lifecycle exit condition occurs. Gross and Robinhood Gold fee-adjusted P&L are theoretical for 1 MNQ; slippage and actual execution differences are excluded.`
  },{headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/signal-log"};
