import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { MNQ_DOLLARS_PER_POINT, theoreticalMark } from "./lib/signal-log.mjs";

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

export default async (_req:Request,_context:Context) => {
  const s=store("mnq-engine");
  const saved:any=await s.get("signal-log",{type:"json"}) || {trades:[]};
  const status:any=await s.get("status",{type:"json"}) || {};
  const trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  const closed=trades.filter(t=>t?.status === "CLOSED" && Number.isFinite(Number(t?.theoreticalPnl)));
  const open=trades.find(t=>t?.status === "OPEN") || null;
  const openMark=open?theoreticalMark(open,status?.price):null;
  const closedPnl=round(closed.reduce((sum,t)=>sum+Number(t.theoreticalPnl||0),0),2);
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
    };
  });

  return Response.json({
    createdAt:saved.createdAt || null,
    updatedAt:saved.updatedAt || null,
    retention:"permanent",
    displayLimit:25,
    totalStoredTrades:trades.length,
    multiplier:MNQ_DOLLARS_PER_POINT,
    basis:"1 MNQ contract",
    downloadUrl:"/api/signal-log.csv",
    stats:{
      closedTrades:closed.length,
      wins,
      losses,
      flats,
      winRate:closed.length?round((wins/closed.length)*100,1):null,
      closedPoints:totalPoints,
      closedPnl,
      openPnl:openMark?.theoreticalPnl ?? null,
      openPoints:openMark?.points ?? null,
    },
    trades:rows,
    note:"All-time theoretical signal-to-signal P&L for 1 MNQ at $2 per Nasdaq-100 point. Full trade history is retained; this table shows the latest 25. Excludes commissions, fees, slippage and actual execution differences."
  },{headers:{"Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/signal-log"};
