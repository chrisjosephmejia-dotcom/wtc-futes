import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { MCL_DOLLARS_PER_POINT, ROBINHOOD_ROUND_TRIP_FEE, V3_START_TRADE_NUMBER, V4_START_TRADE_NUMBER, theoreticalMark, repairKnownLedgerIncidents } from "./lib/signal-log.mjs";
import { STRATEGY_VERSION } from "./lib/position-state.mjs";

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mcl-engine");
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
    multiplier:MCL_DOLLARS_PER_POINT,
    basis:"1 MCL contract",
    feeModel:{provider:"Robinhood Gold + NFA + NYMEX MCL (estimated)",perSide:ROBINHOOD_ROUND_TRIP_FEE/2,roundTrip:ROBINHOOD_ROUND_TRIP_FEE,slippageIncluded:false},
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
    note:`${STRATEGY_VERSION}. MCL V1 paper trade history begins with trade #1. Entries and exits represent shadow signals, not exchange fills. Gross P&L assumes one MCL contract (100 barrels per $1/bbl). Net P&L deducts estimated $2.24 round-trip Robinhood Gold, NYMEX and NFA fees per contract as of October 23, 2026; bid/ask spreads and slippage are NOT included. No fixed hard stop is enabled in shadow research.`
  },{headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/signal-log"};
