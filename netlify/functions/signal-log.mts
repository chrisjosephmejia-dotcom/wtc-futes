import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { MNQ_DOLLARS_PER_POINT, ROBINHOOD_ROUND_TRIP_FEE, theoreticalMark } from "./lib/signal-log.mjs";
import { STRATEGY_VERSION } from "./lib/position-state.mjs";

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mnq-engine");
  const saved:any=await s.get("signal-log",{type:"json"}) || {trades:[],strategyVersion:STRATEGY_VERSION};
  const status:any=await s.get("status",{type:"json"}) || {};
  const trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  const closed=trades.filter(t=>t?.status === "CLOSED" && Number.isFinite(Number(t?.theoreticalPnl)));
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
    displayLimit:25,
    totalStoredTrades:trades.length,
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
    note:`${STRATEGY_VERSION}. Hard risk exits now take priority: exit at -25 MNQ points (-$50 gross) or +300 MNQ points (+$600 gross), evaluated at each engine check. Otherwise ordinary raw WAIT does not exit an open position; long exits at score <= 0, short exits at score >= 0, and a full opposite signal reverses immediately. Gross and Robinhood Gold fee-adjusted P&L are theoretical for 1 MNQ; slippage and actual execution differences are excluded.`
  },{headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/signal-log"};
