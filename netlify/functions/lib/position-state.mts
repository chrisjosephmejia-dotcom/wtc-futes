export const STRATEGY_VERSION = "WTC MCL V1 · +1/-1 EXIT · SHADOW / NO HARD STOP";
export const HARD_STOP_POINTS:number|null = null;
export const DEFAULT_TAKE_PROFIT_POINTS:number|null = null;

export function actionable(signal:any){
  return signal === "BUY MCL" || signal === "SELL MCL";
}

function signedScore(score:any){
  const n=Number(score);
  if(!Number.isFinite(n)) return "—";
  return `${n>0?"+":""}${n}`;
}

function openPositionPoints(raw:any,previous:any,openTrade:any){
  if(!actionable(previous) || !openTrade || openTrade?.status !== "OPEN" || openTrade?.direction !== previous) return null;
  const price=Number(raw?.price);
  const entryPrice=Number(openTrade?.entryPrice);
  if(!Number.isFinite(price) || !Number.isFinite(entryPrice)) return null;
  const side=previous === "BUY MCL" ? 1 : -1;
  return Math.round((price-entryPrice)*side*100)/100;
}

function tradeDailyState(raw:any,openTrade:any){
  return openTrade?.dailyState || raw?.daily?.state || null;
}

function shadowRiskFor(raw:any,previous:any,openTrade:any){
  if(!actionable(previous) || !openTrade || openTrade?.status !== "OPEN" || openTrade?.direction !== previous) return null;
  const entry=Number(openTrade?.entryPrice);
  const high=Number(raw?.market?.lastBarOhlc?.high);
  const low=Number(raw?.market?.lastBarOhlc?.low);
  if(!Number.isFinite(entry) || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  const isLong=previous === "BUY MCL";
  const barMfePoints=Math.round((isLong ? high-entry : entry-low)*100)/100;
  const barMaePoints=Math.round((isLong ? low-entry : entry-high)*100)/100;
  const stopPrice:null = null;
  const stopTouched=false;
  return {
    source:"1M_CANDLE_HIGH_LOW_SHADOW_ONLY",
    barHigh:high,
    barLow:low,
    barMfePoints,
    barMaePoints,
    stopPrice,
    stopTouched,
    note:"Shadow MAE/MFE only; NO HARD STOP in research V1.",
  };
}

export function takeProfitPointsFor(_raw:any,_previous:any,_openTrade:any){
  return DEFAULT_TAKE_PROFIT_POINTS;
}

export function lifecycleLockActive(raw:any,riskLockDirection:any){
  if(!actionable(riskLockDirection)) return false;
  const rawSignal=raw?.signal || "WAIT";
  const score=Number(raw?.score);
  const marketSession=raw?.market?.session !== false;
  const feedActive=raw?.market?.feedActive !== false;
  if(!marketSession || !feedActive || !Number.isFinite(score)) return false;
  if(riskLockDirection === "BUY MCL"){
    return rawSignal !== "SELL MCL" && score > 1;
  }
  return rawSignal !== "BUY MCL" && score < -1;
}

export function resolvePositionState(raw:any,previousSignal:any,openTrade:any=null,riskLockDirection:any=null){
  const rawSignal=raw?.signal || "WAIT";
  const rawReason=raw?.reason || "—";
  const score=Number(raw?.score);
  const previous=actionable(previousSignal)?previousSignal:"WAIT";
  const marketSession=raw?.market?.session !== false;
  const feedActive=raw?.market?.feedActive !== false;
  const openPoints=feedActive ? openPositionPoints(raw,previous,openTrade) : null;
  const dailyState=tradeDailyState(raw,openTrade);
  const takeProfitPoints=takeProfitPointsFor(raw,previous,openTrade);
  const lockActive=lifecycleLockActive(raw,riskLockDirection);
  const shadowRisk=shadowRiskFor(raw,previous,openTrade);
  let signal="WAIT";
  let reason=rawReason;
  let positionEvent="FLAT";
  let riskTrigger:any=null;

  if(previous === "BUY MCL"){
    if(!marketSession){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT LONG · SESSION CLOSED · ${rawReason}`;
    } else if(!feedActive || !Number.isFinite(score)){
      signal="BUY MCL";
      positionEvent="HOLD";
      reason=`HOLD LONG · DATA FEED PAUSED · ${rawReason}`;
    } else if(false /* no hard stop in MCL V1 research */){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="STOP_LOSS";
      reason=`EXIT LONG · HARD STOP ${openPoints.toFixed(2)} PTS <= -${HARD_STOP_POINTS} PTS (-$50 GROSS)`;
    } else if(takeProfitPoints !== null && openPoints !== null && Number.isFinite(Number(takeProfitPoints)) && openPoints >= Number(takeProfitPoints)){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="TAKE_PROFIT";
      reason=`EXIT LONG · TAKE PROFIT ${openPoints.toFixed(2)} PTS >= +${Number(takeProfitPoints)} PTS (${Number(takeProfitPoints)*2} GROSS)`;
    } else if(rawSignal === "SELL MCL"){
      signal="SELL MCL";
      positionEvent="REVERSE";
      reason=`REVERSE LONG→SHORT · ${rawReason}`;
    } else if(score <= 1){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT LONG · SCORE ${signedScore(score)} <= +1`;
    } else {
      signal="BUY MCL";
      positionEvent="HOLD";
      reason=rawSignal === "BUY MCL" ? rawReason : `HOLD LONG · RAW ${rawSignal} · SCORE ${signedScore(score)} > +1`;
    }
  } else if(previous === "SELL MCL"){
    if(!marketSession){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT SHORT · SESSION CLOSED · ${rawReason}`;
    } else if(!feedActive || !Number.isFinite(score)){
      signal="SELL MCL";
      positionEvent="HOLD";
      reason=`HOLD SHORT · DATA FEED PAUSED · ${rawReason}`;
    } else if(false /* no hard stop in MCL V1 research */){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="STOP_LOSS";
      reason=`EXIT SHORT · HARD STOP ${openPoints.toFixed(2)} PTS <= -${HARD_STOP_POINTS} PTS (-$50 GROSS)`;
    } else if(takeProfitPoints !== null && openPoints !== null && Number.isFinite(Number(takeProfitPoints)) && openPoints >= Number(takeProfitPoints)){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="TAKE_PROFIT";
      reason=`EXIT SHORT · TAKE PROFIT ${openPoints.toFixed(2)} PTS >= +${Number(takeProfitPoints)} PTS (+${Number(takeProfitPoints)*2} GROSS · ${dailyState || "NO DAILY STATE"})`;
    } else if(rawSignal === "BUY MCL"){
      signal="BUY MCL";
      positionEvent="REVERSE";
      reason=`REVERSE SHORT→LONG · ${rawReason}`;
    } else if(score >= -1){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT SHORT · SCORE ${signedScore(score)} >= -1`;
    } else {
      signal="SELL MCL";
      positionEvent="HOLD";
      reason=rawSignal === "SELL MCL" ? rawReason : `HOLD SHORT · RAW ${rawSignal} · SCORE ${signedScore(score)} < -1`;
    }
  } else if(lockActive && rawSignal === riskLockDirection){
    signal="WAIT";
    positionEvent="LOCKOUT";
    reason=`RISK EXIT LIFECYCLE LOCKOUT · WAIT FOR NORMAL V1 ${riskLockDirection === "BUY MCL" ? "LONG EXIT (SCORE <= +1 OR SELL)" : "SHORT EXIT (SCORE >= -1 OR BUY)"}`;
  } else if(actionable(rawSignal)){
    signal=rawSignal;
    positionEvent="ENTER";
    reason=rawReason;
  }

  return {
    ...raw,
    strategyVersion:STRATEGY_VERSION,
    rawSignal,
    rawReason,
    previousPosition:previous,
    signal,
    reason,
    positionEvent,
    riskCap:{
      hardStopPoints:HARD_STOP_POINTS,
      takeProfitPoints,
      dailyState,
      openPoints,
      trigger:riskTrigger,
      lockDirection:riskLockDirection || null,
      lockActive,
      shadowRisk,
    },
  };
}
