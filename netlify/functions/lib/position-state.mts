export const STRATEGY_VERSION = "WTC V2 · SCORE-0 HYSTERESIS";

export function actionable(signal:any){
  return signal === "BUY MNQ" || signal === "SELL MNQ";
}

function signedScore(score:any){
  const n=Number(score);
  if(!Number.isFinite(n)) return "—";
  return `${n>0?"+":""}${n}`;
}

export function resolvePositionState(raw:any, previousSignal:any){
  const rawSignal=raw?.signal || "WAIT";
  const rawReason=raw?.reason || "—";
  const score=Number(raw?.score);
  const previous=actionable(previousSignal)?previousSignal:"WAIT";
  const marketSession=raw?.market?.session !== false;
  const feedActive=raw?.market?.feedActive !== false;
  let signal="WAIT";
  let reason=rawReason;
  let positionEvent="FLAT";

  if(previous === "BUY MNQ"){
    if(!marketSession || !feedActive || !Number.isFinite(score)){
      signal="WAIT";
      positionEvent="EXIT";
      reason=`EXIT LONG · DATA/SESSION SAFETY · ${rawReason}`;
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
  };
}
