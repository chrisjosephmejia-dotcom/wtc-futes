import { store } from "./storage.mjs";
import { STRATEGY_VERSION, actionable, HARD_STOP_POINTS, TAKE_PROFIT_POINTS } from "./position-state.mjs";

const MNQ_DOLLARS_PER_POINT = 2;
const ROBINHOOD_FEE_PER_SIDE = 0.86;
const ROBINHOOD_ROUND_TRIP_FEE = ROBINHOOD_FEE_PER_SIDE * 2;
const RISK_MODEL = {
  hardStopPoints:HARD_STOP_POINTS,
  hardStopGrossDollars:HARD_STOP_POINTS*MNQ_DOLLARS_PER_POINT,
  takeProfitPoints:TAKE_PROFIT_POINTS,
  takeProfitGrossDollars:TAKE_PROFIT_POINTS*MNQ_DOLLARS_PER_POINT,
};

function round(n:number, digits=2){
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
  if(existing?.strategyVersion === STRATEGY_VERSION) return existing;

  const oldTrades=Array.isArray(existing?.trades)?existing.trades:[];
  if(oldTrades.length){
    await s.setJSON("signal-log-archive-pre-v2",{
      ...existing,
      archivedAt:new Date().toISOString(),
      archiveReason:`Production lifecycle changed to ${STRATEGY_VERSION}`,
    });
  }
  return {trades:[],createdAt:new Date().toISOString(),strategyVersion:STRATEGY_VERSION};
}

export async function updateSignalLog(current:any){
  const s=store("mnq-engine");
  const saved:any=await loadCurrentLedger();
  let trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  let openIndex=trades.findIndex(t=>t?.status === "OPEN");
  const isActionable=actionable(current?.signal);
  let changed=false;

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
    trades.unshift({
      id:`${now}-${current.signal}`,
      strategyVersion:STRATEGY_VERSION,
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

  if(!changed && saved?.version >= 4) return saved;

  const now=new Date().toISOString();
  const result={
    version:4,
    strategyVersion:STRATEGY_VERSION,
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
  const saved:any=await s.get(key,{type:"json"}) || {version:1,strategyVersion:STRATEGY_VERSION,date:day,entries:[]};
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
  });
  const result={...saved,version:1,strategyVersion:STRATEGY_VERSION,date:day,updatedAt:new Date().toISOString(),entries};
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

export { MNQ_DOLLARS_PER_POINT, ROBINHOOD_FEE_PER_SIDE, ROBINHOOD_ROUND_TRIP_FEE };
