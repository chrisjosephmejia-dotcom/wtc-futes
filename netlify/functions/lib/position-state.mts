export const STRATEGY_VERSION = "WTC V2 · SCORE-0 HYSTERESIS";
export const HARD_STOP_POINTS = 25;
export const TAKE_PROFIT_POINTS = 300;

export function actionable(signal:any){
  return signal === "BUY MNQ" || signal === "SELL MNQ";
}

function signedScore(score:any){
  const n=Number(score);
  if(!Number.isFinite(n)) return "—";
  return `${n>0?"+":""}${n}`;
}

function openPositionPoints(raw:any, previous:any, openTrade:any){
  if(!actionable(previous) || !openTrade || openTrade?.status !== "OPEN" || openTrade?.direction !== previous) return null;
  const price=Number(raw?.price);
  const entryPrice=Number(openTrade?.entryPrice);
  if(!Number.isFinite(price) || !Number.isFinite(entryPrice)) return null;
  const side=previous === "BUY MNQ" ? 1 : -1;
  return Math.round((price-entryPrice)*side*100)/100;
}

export function resolvePositionState(raw:any, previousSignal:any, openTrade:any=null){
  const rawSignal=raw?.signal || "WAIT";
  const rawReason=raw?.reason || "—";
  const score=Number(raw?.score);
  const previous=actionable(previousSignal)?previousSignal:"WAIT";
  const marketSession=raw?.market?.session !== false;
  const feedActive=raw?.market?.feedActive !== false;
  const openPoints=openPositionPoints(raw,previous,openTrade);
  let signal="WAIT";
  let reason=rawReason;
  let positionEvent="FLAT";
  let riskTrigger:any=null;

  if(previous === "BUY MNQ"){
    if(!marketSession || !feedActive || !Number.isFinite(score)){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT LONG · DATA/SESSION SAFETY · ${rawReason}`;
    } else if(openPoints !== null && openPoints <= -HARD_STOP_POINTS){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="STOP_LOSS";
      reason=`EXIT LONG · HARD STOP ${openPoints.toFixed(2)} PTS <= -${HARD_STOP_POINTS} PTS (-$50 GROSS)`;
    } else if(openPoints !== null && openPoints >= TAKE_PROFIT_POINTS){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="TAKE_PROFIT";
      reason=`EXIT LONG · TAKE PROFIT ${openPoints.toFixed(2)} PTS >= +${TAKE_PROFIT_POINTS} PTS (+$600 GROSS)`;
    } else if(rawSignal === "SELL MNQ"){
      signal="SELL MNQ";
      positionEvent="REVERSE";
      reason=`REVERSE LONG→SHORT · ${rawReason}`;
    } else if(score <= 0){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT LONG · SCORE ${signedScore(score)} <= 0`;
    } else {
      signal="BUY MNQ";
      positionEvent="HOLD";
      reason=rawSignal === "BUY MNQ" ? rawReason : `HOLD LONG · RAW ${rawSignal} · SCORE ${signedScore(score)} > 0`;
    }
  } else if(previous === "SELL MNQ"){
    if(!marketSession || !feedActive || !Number.isFinite(score)){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT SHORT · DATA/SESSION SAFETY · ${rawReason}`;
    } else if(openPoints !== null && openPoints <= -HARD_STOP_POINTS){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="STOP_LOSS";
      reason=`EXIT SHORT · HARD STOP ${openPoints.toFixed(2)} PTS <= -${HARD_STOP_POINTS} PTS (-$50 GROSS)`;
    } else if(openPoints !== null && openPoints >= TAKE_PROFIT_POINTS){
      signal="WAIT";
      positionEvent="EXIT";
      riskTrigger="TAKE_PROFIT";
      reason=`EXIT SHORT · TAKE PROFIT ${openPoints.toFixed(2)} PTS >= +${TAKE_PROFIT_POINTS} PTS (+$600 GROSS)`;
    } else if(rawSignal === "BUY MNQ"){
      signal="BUY MNQ";
      positionEvent="REVERSE";
      reason=`REVERSE SHORT→LONG · ${rawReason}`;
    } else if(score >= 0){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT SHORT · SCORE ${signedScore(score)} >= 0`;
    } else {
      signal="SELL MNQ";
      positionEvent="HOLD";
      reason=rawSignal === "SELL MNQ" ? rawReason : `HOLD SHORT · RAW ${rawSignal} · SCORE ${signedScore(score)} < 0`;
    }
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
      takeProfitPoints:TAKE_PROFIT_POINTS,
      openPoints,
      trigger:riskTrigger,
    },
  };
}
