import { store } from "./storage.mjs";
import {
  STRATEGY_VERSION,
  actionable,
  HARD_STOP_POINTS,
  DEFAULT_TAKE_PROFIT_POINTS,
} from "./position-state.mjs";

const MCL_DOLLARS_PER_POINT = 100;
const ROBINHOOD_FEE_PER_SIDE = 1.12; // Estimated Robinhood Gold MCL all-in cost per side as of 2026-10-23: $0.50 commission + $0.02 NFA + $0.60 NYMEX exchange.
const ROBINHOOD_ROUND_TRIP_FEE = ROBINHOOD_FEE_PER_SIDE * 2;
const V3_START_TRADE_NUMBER = 1;
const V4_START_TRADE_NUMBER = 1;
const LEGACY_V3_VERSION = "WTC MCL V1 · SHADOW";
const LEDGER_VERSION = 11; // MCL V1 exchange-fee normalization
const STALE_FEED_INCIDENT = {
  primaryTradeNumber:-1,
  voidTradeNumbers:new Set<number>(),
  reason:"Legacy MNQ incident not applicable to MCL V1; disabled",
  canonicalPrimaryClose:{
    status:"CLOSED",
    closedAt:"2026-10-12T00:51:04.168Z",
    exitPrice:31218.75,
    exitScore:-3,
    exitSignal:"WAIT",
    exitRawSignal:"WAIT",
    exitReason:"EXIT LONG · SCORE -3 <= 0",
    exitRawReason:"TIMEFRAME CONFLICT · WAIT",
    points:45,
    theoreticalPnl:90,
    roundTripFees:1.72,
    netPnlBeforeSlippage:88.28,
    durationMinutes:166,
    eligibleForStats:true,
    auditStatus:"RECONSTRUCTED",
  },
};
const RISK_MODEL = {
  hardStopPoints:HARD_STOP_POINTS,
  hardStopGrossDollars:null,
  defaultTakeProfitPoints:DEFAULT_TAKE_PROFIT_POINTS,
  defaultTakeProfitGrossDollars:DEFAULT_TAKE_PROFIT_POINTS === null ? null : DEFAULT_TAKE_PROFIT_POINTS*MCL_DOLLARS_PER_POINT,
  uncappedWinnerExit:"No fixed take-profit or hard stop in MCL V1 SHADOW; exits at long <=+1, short >=-1, reversal or session close.",
  intraminuteShadow:"Record 1-minute candle high/low MAE and MFE. Stop loss not enabled in MCL shadow research.",
  lifecycleLockout:"No hard-risk stop is active in MCL V1; standard lifecycle / re-entry behavior otherwise retained.",
  v3StartTradeNumber:V3_START_TRADE_NUMBER,
  v4StartTradeNumber:V4_START_TRADE_NUMBER,
};

function round(n:number,digits=2){
  const p=10**digits;
  return Math.round(n*p)/p;
}

function alignment(current:any){
  const f=current?.frames || {};
  return ["30m","15m","5m","1m"].map(k=>f?.[k]?.state || "—").join("/");
}

function mclContract(nqSymbol:any){
  const s=String(nqSymbol || "");
  return s.startsWith("/MCL") ? s.replace("/MCL","/MCL") : "MCL";
}

function incidentOriginal(trade:any){
  return {
    status:trade?.status ?? null,
    closedAt:trade?.closedAt ?? null,
    exitPrice:trade?.exitPrice ?? null,
    exitScore:trade?.exitScore ?? null,
    exitSignal:trade?.exitSignal ?? null,
    exitRawSignal:trade?.exitRawSignal ?? null,
    exitReason:trade?.exitReason ?? null,
    exitRawReason:trade?.exitRawReason ?? null,
    points:trade?.points ?? null,
    theoreticalPnl:trade?.theoreticalPnl ?? null,
    roundTripFees:trade?.roundTripFees ?? null,
    netPnlBeforeSlippage:trade?.netPnlBeforeSlippage ?? null,
    durationMinutes:trade?.durationMinutes ?? null,
  };
}

function updateEstimatedClosedTradeFees(trades:any[]){
  let changed=false;
  for(const trade of trades){
    if(trade?.status !== "CLOSED" || !Number.isFinite(Number(trade?.theoreticalPnl))) continue;
    const fee=round(ROBINHOOD_ROUND_TRIP_FEE,2);
    const net=round(Number(trade.theoreticalPnl)-fee,2);
    if(trade.roundTripFees !== fee || trade.netPnlBeforeSlippage !== net){
      trade.roundTripFees=fee;
      trade.netPnlBeforeSlippage=net;
      trade.feeModelVersion="MCL_EST_FEE_2026_10_23";
      changed=true;
    }
  }
  return changed;
}

export function repairKnownLedgerIncidents(saved:any){
  const trades=normalizeTradeHistory(Array.isArray(saved?.trades)?saved.trades:[]);
  const feesChanged=updateEstimatedClosedTradeFees(trades);
  if(Number(saved?.version || 0) >= LEDGER_VERSION){
    const primary=trades.find((t:any)=>Number(t?.tradeNumber)===STALE_FEED_INCIDENT.primaryTradeNumber);
    const restoredSignal=primary?.status === "OPEN" && primary?.auditStatus === "RECONSTRUCTED" && actionable(primary?.direction)
      ? primary.direction
      : null;
    return {ledger:{...saved,trades,version:LEDGER_VERSION},repaired:feesChanged,restoredSignal};
  }
  let repaired=feesChanged;
  let restoredSignal:any=null;

  const primary=trades.find((t:any)=>Number(t?.tradeNumber)===STALE_FEED_INCIDENT.primaryTradeNumber);
  const hasIncidentChildren=trades.some((t:any)=>STALE_FEED_INCIDENT.voidTradeNumbers.has(Number(t?.tradeNumber)));

  if(primary && primary?.auditStatus === "RECONSTRUCTED"){
    const canonical=STALE_FEED_INCIDENT.canonicalPrimaryClose;
    const corrupted=
      primary?.status !== canonical.status ||
      primary?.closedAt !== canonical.closedAt ||
      Number(primary?.exitPrice) !== canonical.exitPrice ||
      Number(primary?.theoreticalPnl) !== canonical.theoreticalPnl;
    if(corrupted){
      Object.assign(primary,canonical,{
        reconstructionReason:STALE_FEED_INCIDENT.reason,
        incidentRepairVersion:LEDGER_VERSION,
      });
      repaired=true;
    }
  }

  if(primary && hasIncidentChildren && primary?.status !== "OPEN" && primary?.auditStatus !== "RECONSTRUCTED"){
    if(!primary.auditOriginal) primary.auditOriginal=incidentOriginal(primary);
    Object.assign(primary,{
      status:"OPEN",
      closedAt:null,
      exitPrice:null,
      exitScore:null,
      exitSignal:null,
      exitRawSignal:null,
      exitReason:null,
      exitRawReason:null,
      points:null,
      theoreticalPnl:null,
      roundTripFees:null,
      netPnlBeforeSlippage:null,
      durationMinutes:null,
      eligibleForStats:true,
      auditStatus:"RECONSTRUCTED",
      reconstructionReason:STALE_FEED_INCIDENT.reason,
      incidentRepairVersion:LEDGER_VERSION,
    });
    restoredSignal=primary.direction;
    repaired=true;
  }

  for(const trade of trades){
    if(!STALE_FEED_INCIDENT.voidTradeNumbers.has(Number(trade?.tradeNumber))) continue;
    if(!trade.auditOriginal) trade.auditOriginal=incidentOriginal(trade);
    Object.assign(trade,{
      status:"VOID",
      eligibleForStats:false,
      auditStatus:"VOID_STALE_FEED_BUG",
      voidReason:STALE_FEED_INCIDENT.reason,
    });
    repaired=true;
  }

  return {
    ledger:{...saved,version:LEDGER_VERSION,trades,incidentRepairAt:new Date().toISOString()},
    repaired,
    restoredSignal,
  };
}

function normalizeTradeHistory(trades:any[]){
  const chronological=[...trades].reverse();
  const normalized=chronological.map((trade:any,index:number)=>{
    const tradeNumber=index+1;
    const next:any={...trade,tradeNumber};
    if(tradeNumber >= V4_START_TRADE_NUMBER) next.strategyVersion=STRATEGY_VERSION;
    else if(tradeNumber >= V3_START_TRADE_NUMBER) next.strategyVersion=LEGACY_V3_VERSION;
    return next;
  });
  return normalized.reverse();
}

function closeTrade(trade:any,current:any){
  if(!Number.isFinite(Number(current?.price))) return trade;
  const exitPrice=Number(current.price);
  const side=trade.direction === "BUY MCL" ? 1 : -1;
  const points=round((exitPrice-Number(trade.entryPrice))*side,2);
  const theoreticalPnl=round(points*MCL_DOLLARS_PER_POINT,2);
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
  const s=store("mcl-engine");
  const existing:any=await s.get("signal-log",{type:"json"}) || {};
  const repaired=repairKnownLedgerIncidents(existing);
  const trades=normalizeTradeHistory(Array.isArray(repaired.ledger?.trades)?repaired.ledger.trades:[]);
  return {
    ...repaired.ledger,
    trades,
    createdAt:repaired.ledger.createdAt || new Date().toISOString(),
  };
}

export async function updateSignalLog(current:any){
  const s=store("mcl-engine");
  const saved:any=await loadCurrentLedger();
  let trades:any[]=Array.isArray(saved.trades)?saved.trades:[];
  let openIndex=trades.findIndex(t=>t?.status === "OPEN");
  const isActionable=actionable(current?.signal);
  let changed=saved?.version < LEDGER_VERSION || saved?.strategyVersion !== STRATEGY_VERSION;

  if(openIndex >= 0){
    const open=trades[openIndex];
    const shadow=current?.riskCap?.shadowRisk;
    if(shadow){
      const prevMfe=Number(open?.shadowMfePoints);
      const prevMae=Number(open?.shadowMaePoints);
      const nextMfe=Number(shadow?.barMfePoints);
      const nextMae=Number(shadow?.barMaePoints);
      if(Number.isFinite(nextMfe)){
        open.shadowMfePoints=Number.isFinite(prevMfe)?Math.max(prevMfe,nextMfe):nextMfe;
        changed=true;
      }
      if(Number.isFinite(nextMae)){
        open.shadowMaePoints=Number.isFinite(prevMae)?Math.min(prevMae,nextMae):nextMae;
        changed=true;
      }
      if(shadow?.stopTouched){
        if(!open.shadowStopTouched) changed=true;
        open.shadowStopTouched=true;
        open.shadowStopPrice=Number.isFinite(Number(shadow?.stopPrice))?Number(shadow.stopPrice):open.shadowStopPrice ?? null;
        open.shadowFirstStopTouchAt=open.shadowFirstStopTouchAt || current?.market?.lastBar || current?.checkedAt || new Date().toISOString();
      }
      open.shadowLastBarHigh=Number.isFinite(Number(shadow?.barHigh))?Number(shadow.barHigh):open.shadowLastBarHigh ?? null;
      open.shadowLastBarLow=Number.isFinite(Number(shadow?.barLow))?Number(shadow.barLow):open.shadowLastBarLow ?? null;
    }
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
      strategyVersion:tradeNumber >= V4_START_TRADE_NUMBER ? STRATEGY_VERSION : (tradeNumber >= V3_START_TRADE_NUMBER ? LEGACY_V3_VERSION : (saved.strategyVersion || LEGACY_V3_VERSION)),
      status:"OPEN",
      direction:current.signal,
      contract:mclContract(current?.instrument?.symbol),
      sourceContract:current?.instrument?.symbol || "MCL",
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
      shadowMfePoints:null,
      shadowMaePoints:null,
      shadowStopTouched:false,
      shadowStopPrice:null,
      shadowFirstStopTouchAt:null,
      shadowLastBarHigh:null,
      shadowLastBarLow:null,
    });
    changed=true;
  }

  if(!changed) return saved;

  const now=new Date().toISOString();
  const result={
    version:LEDGER_VERSION,
    strategyVersion:STRATEGY_VERSION,
    v3StartTradeNumber:V3_START_TRADE_NUMBER,
    v4StartTradeNumber:V4_START_TRADE_NUMBER,
    riskModel:RISK_MODEL,
    multiplier:MCL_DOLLARS_PER_POINT,
    feeModel:{provider:"Robinhood Gold + NFA + NYMEX MCL (estimated, 2026-10-23)",perSide:ROBINHOOD_FEE_PER_SIDE,roundTrip:ROBINHOOD_ROUND_TRIP_FEE,slippageIncluded:false},
    createdAt:saved.createdAt || now,
    updatedAt:now,
    retention:"permanent",
    trades,
  };
  await s.setJSON("signal-log",result);
  return result;
}

export async function appendDecisionSnapshot(current:any){
  const s=store("mcl-engine");
  const checkedAt=current?.checkedAt || new Date().toISOString();
  const day=checkedAt.slice(0,10);
  const key=`decision-log/${day}`;
  const saved:any=await s.get(key,{type:"json"}) || {version:3,date:day,entries:[]};
  const entries:any[]=Array.isArray(saved.entries)?saved.entries:[];
  const minute=checkedAt.slice(0,16);
  if(entries.length && String(entries[entries.length-1]?.checkedAt||"").slice(0,16) === minute) return saved;
  const f=current?.frames || {};
  entries.push({
    checkedAt,
    strategyVersion:STRATEGY_VERSION,
    sourceContract:current?.instrument?.symbol || "MCL",
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
    shadowStopTouched:current?.riskCap?.shadowRisk?.stopTouched ?? null,
    shadowStopPrice:Number.isFinite(Number(current?.riskCap?.shadowRisk?.stopPrice))?Number(current.riskCap.shadowRisk.stopPrice):null,
    shadowBarMfePoints:Number.isFinite(Number(current?.riskCap?.shadowRisk?.barMfePoints))?Number(current.riskCap.shadowRisk.barMfePoints):null,
    shadowBarMaePoints:Number.isFinite(Number(current?.riskCap?.shadowRisk?.barMaePoints))?Number(current.riskCap.shadowRisk.barMaePoints):null,
    shadowBarHigh:Number.isFinite(Number(current?.riskCap?.shadowRisk?.barHigh))?Number(current.riskCap.shadowRisk.barHigh):null,
    shadowBarLow:Number.isFinite(Number(current?.riskCap?.shadowRisk?.barLow))?Number(current.riskCap.shadowRisk.barLow):null,
    engineError:current?.error || null,
    source:current?.source || null,
    open:Number.isFinite(Number(current?.open))?Number(current.open):null,
    openingRangeLow:Number.isFinite(Number(current?.openingRange?.low))?Number(current.openingRange.low):null,
    openingRangeHigh:Number.isFinite(Number(current?.openingRange?.high))?Number(current.openingRange.high):null,
    thresholdBuy:Number.isFinite(Number(current?.threshold?.buy))?Number(current.threshold.buy):null,
    thresholdSell:Number.isFinite(Number(current?.threshold?.sell))?Number(current.threshold.sell):null,
    extensionPct:Number.isFinite(Number(current?.extension?.pct))?Number(current.extension.pct):null,
    extensionLimitPct:Number.isFinite(Number(current?.extension?.limitPct))?Number(current.extension.limitPct):null,
    dailyRsi:Number.isFinite(Number(current?.daily?.rsi))?Number(current.daily.rsi):null,
    dailyEma20:Number.isFinite(Number(current?.daily?.ema20))?Number(current.daily.ema20):null,
    dailyEma50:Number.isFinite(Number(current?.daily?.ema50))?Number(current.daily.ema50):null,
    frame30Detail:f?.["30m"] || null,
    frame15Detail:f?.["15m"] || null,
    frame5Detail:f?.["5m"] || null,
    frame1Detail:f?.["1m"] || null,
    lastBar:current?.market?.lastBar || null,
    lastBarLabel:current?.market?.lastBarLabel || null,
    ageSec:Number.isFinite(Number(current?.market?.ageSec))?Number(current.market.ageSec):null,
    minuteBars:Number.isFinite(Number(current?.instrument?.minuteBars))?Number(current.instrument.minuteBars):null,
    dailyBars:Number.isFinite(Number(current?.instrument?.dailyBars))?Number(current.instrument.dailyBars):null,
  });
  const result={...saved,version:3,strategyVersion:STRATEGY_VERSION,date:day,updatedAt:new Date().toISOString(),entries};
  await s.setJSON(key,result);
  return result;
}

export function theoreticalMark(trade:any,price:any){
  if(!trade || !Number.isFinite(Number(price))) return null;
  const side=trade.direction === "BUY MCL" ? 1 : -1;
  const points=round((Number(price)-Number(trade.entryPrice))*side,2);
  const theoreticalPnl=round(points*MCL_DOLLARS_PER_POINT,2);
  return {points,theoreticalPnl,netPnlBeforeSlippage:round(theoreticalPnl-ROBINHOOD_ROUND_TRIP_FEE,2)};
}

export {
  MCL_DOLLARS_PER_POINT,
  ROBINHOOD_FEE_PER_SIDE,
  ROBINHOOD_ROUND_TRIP_FEE,
  V3_START_TRADE_NUMBER,
  V4_START_TRADE_NUMBER,
};
