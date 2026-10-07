import { store } from "./storage.mjs";
import {
  STRATEGY_VERSION,
  actionable,
  HARD_STOP_POINTS,
  DEFAULT_TAKE_PROFIT_POINTS,
  BULLISH_SHORT_TAKE_PROFIT_POINTS,
} from "./position-state.mjs";

const MNQ_DOLLARS_PER_POINT = 2;
const ROBINHOOD_FEE_PER_SIDE = 0.86;
const ROBINHOOD_ROUND_TRIP_FEE = ROBINHOOD_FEE_PER_SIDE * 2;
const V3_START_TRADE_NUMBER = 47;
const RISK_MODEL = {
  hardStopPoints:HARD_STOP_POINTS,
  hardStopGrossDollars:HARD_STOP_POINTS*MNQ_DOLLARS_PER_POINT,
  defaultTakeProfitPoints:DEFAULT_TAKE_PROFIT_POINTS,
  defaultTakeProfitGrossDollars:DEFAULT_TAKE_PROFIT_POINTS*MNQ_DOLLARS_PER_POINT,
  bullishShortTakeProfitPoints:BULLISH_SHORT_TAKE_PROFIT_POINTS,
  bullishShortTakeProfitGrossDollars:BULLISH_SHORT_TAKE_PROFIT_POINTS*MNQ_DOLLARS_PER_POINT,
  lifecycleLockout:"After a hard exit, block same-direction re-entry until the original V2 lifecycle exit condition occurs.",
  v3StartTradeNumber:V3_START_TRADE_NUMBER,
};

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

function alignment(current:any){
  const f=current?.frames || {};
  return ["30m","15m","5m","1m"].map(k=>f?.[k]?.state || "—").join("/");
}

function mnqContract(nqSymbol:any){
  const s=String(nqSymbol || "");
  return s.startsWith("/NQ") ? s.replace("/NQ","/MNQ") : "MNQ";
}

function normalizeTradeHistory(trades:any[]){
  const chronological=[...trades].reverse();
  const normalized=chronological.map((trade:any,index:number)=>{
    const tradeNumber=index+1;
    const next:any={...trade,tradeNumber};
    if(tradeNumber >= V3_START_TRADE_NUMBER) next.strategyVersion=STRATEGY_VERSION;
    return next;
  });
  return normalized.reverse();
}

function closeTrade(trade:any,current:any){
  if(!Number.isFinite(Number(current?.price))) return trade;
  const exitPrice=Number(current.price);
  const side=trade.direction === "BUY MNQ" ? 1 : -1;
  const points=round((exitPrice-Number(trade.entryPrice))*side,2);
  const theoreticalPnl=round(points*MNQ_DOLLARS_PER_POINT,2);
  const opened=Date.parse(trade.openedAt);
  const closed=Date.parse(current.checkedAt || new Date().toISOString());
  return {
    ...trade,
    status:"CLOSED",
    closedAt:current.checkedAt || new Date().toISOString(),
    exitPrice:round(exitPrice,2),
    exitSignal:current.signal || "WAIT",
    exitRawSignal:current.rawSignal || current.signal || "WAIT",
    exitScore:Number.isFinite(Number(current.score))?Number(current.score):null,
    exitReason:current.reason || "POSITION EXIT",
    exitRawReason:current.rawReason || current.reason || "—",
    points,
    theoreticalPnl,
    roundTripFees:ROBINHOOD_ROUND_TRIP_FEE,
    netPnlBeforeSlippage:round(theoreticalPnl-ROBINHOOD_ROUND_TRIP_FEE,2),
    durationMinutes:Number.isFinite(opened)&&Number.isFinite(closed)?round(Math.max(0,(closed-opened)/60000),1):null,
  };
}

async function loadCurrentLedger(){
  const s=store("mnq-engine");
  const existing:any=await s.get("signal-log",{type:"json"}) || {};
  const trades=normalizeTradeHistory(Array.isArray(existing?.trades)?existing.trades:[]);
  return {
    ...existing,
    trades,
    createdAt:existing.createdAt || new Date().toISOString(),
  };
}

export async function updateSignalLog(current:any){
  const s=store("mnq-engine");
  const saved:any=await loadCurrentLedger();
  let trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  let openIndex=trades.findIndex(t=>t?.status === "OPEN");
  const isActionable=actionable(current?.signal);
  let changed=saved?.version < 5 || saved?.strategyVersion !== STRATEGY_VERSION;

  if(openIndex >= 0){
    const open=trades[openIndex];
    if(!isActionable || current.signal !== open.direction){
      const closed=closeTrade(open,current);
      if(closed?.status === "CLOSED"){
        trades[openIndex]=closed;
        changed=true;
      }
      openIndex=-1;
    }
  }

  const hasOpen=trades.some(t=>t?.status === "OPEN");
  if(isActionable && !hasOpen && Number.isFinite(Number(current?.price))){
    const now=current.checkedAt || new Date().toISOString();
    const tradeNumber=trades.length+1;
    trades.unshift({
      id:`${now}-${current.signal}`,
      tradeNumber,
      strategyVersion:tradeNumber >= V3_START_TRADE_NUMBER ? STRATEGY_VERSION : (saved.strategyVersion || STRATEGY_VERSION),
      status:"OPEN",
      direction:current.signal,
      contract:mnqContract(current?.instrument?.symbol),
      sourceContract:current?.instrument?.symbol || "NQ",
      openedAt:now,
      entryPrice:round(Number(current.price),2),
      entryScore:Number.isFinite(Number(current.score))?Number(current.score):null,
      entrySignal:current.signal,
      entryRawSignal:current.rawSignal || current.signal,
      entryReason:current.reason || "—",
      entryRawReason:current.rawReason || current.reason || "—",
      alignment:alignment(current),
      dailyState:current?.daily?.state || null,
      riskModel:RISK_MODEL,
    });
    changed=true;
  }

  if(!changed) return saved;

  const now=new Date().toISOString();
  const result={
    version:5,
    strategyVersion:STRATEGY_VERSION,
    v3StartTradeNumber:V3_START_TRADE_NUMBER,
    riskModel:RISK_MODEL,
    multiplier:MNQ_DOLLARS_PER_POINT,
    feeModel:{provider:"Robinhood Gold",perSide:ROBINHOOD_FEE_PER_SIDE,roundTrip:ROBINHOOD_ROUND_TRIP_FEE},
    createdAt:saved.createdAt || now,
    updatedAt:now,
    retention:"permanent",
    trades,
  };
  await s.setJSON("signal-log",result);
  return result;
}

export async function appendDecisionSnapshot(current:any){
  const s=store("mnq-engine");
  const checkedAt=current?.checkedAt || new Date().toISOString();
  const day=checkedAt.slice(0,10);
  const key=`decision-log/${day}`;
  const saved:any=await s.get(key,{type:"json"}) || {version:2,date:day,entries:[]};
  const entries:any[]=Array.isArray(saved.entries)?saved.entries:[];
  const minute=checkedAt.slice(0,16);
  if(entries.length && String(entries[entries.length-1]?.checkedAt||"").slice(0,16) === minute) return saved;
  const f=current?.frames || {};
  entries.push({
    checkedAt,
    strategyVersion:STRATEGY_VERSION,
    sourceContract:current?.instrument?.symbol || "NQ",
    price:Number.isFinite(Number(current?.price))?Number(current.price):null,
    score:Number.isFinite(Number(current?.score))?Number(current.score):null,
    rawSignal:current?.rawSignal || current?.signal || "WAIT",
    rawReason:current?.rawReason || current?.reason || "—",
    positionSignal:current?.signal || "WAIT",
    positionEvent:current?.positionEvent || null,
    positionReason:current?.reason || "—",
    dailyState:current?.daily?.state || null,
    frame30:f?.["30m"]?.state || null,
    frame15:f?.["15m"]?.state || null,
    frame5:f?.["5m"]?.state || null,
    frame1:f?.["1m"]?.state || null,
    vwap:Number.isFinite(Number(current?.vwap))?Number(current.vwap):null,
    feedActive:current?.market?.feedActive ?? null,
    session:current?.market?.session ?? null,
    inEntry:current?.market?.inEntry ?? null,
    extensionBlocked:current?.extension?.blocked ?? null,
    riskCap:current?.riskCap || null,
  });
  const result={...saved,version:2,strategyVersion:STRATEGY_VERSION,date:day,updatedAt:new Date().toISOString(),entries};
  await s.setJSON(key,result);
  return result;
}

export function theoreticalMark(trade:any,price:any){
  if(!trade || !Number.isFinite(Number(price))) return null;
  const side=trade.direction === "BUY MNQ" ? 1 : -1;
  const points=round((Number(price)-Number(trade.entryPrice))*side,2);
  const theoreticalPnl=round(points*MNQ_DOLLARS_PER_POINT,2);
  return {points,theoreticalPnl,netPnlBeforeSlippage:round(theoreticalPnl-ROBINHOOD_ROUND_TRIP_FEE,2)};
}

export {
  MNQ_DOLLARS_PER_POINT,
  ROBINHOOD_FEE_PER_SIDE,
  ROBINHOOD_ROUND_TRIP_FEE,
  V3_START_TRADE_NUMBER,
};
