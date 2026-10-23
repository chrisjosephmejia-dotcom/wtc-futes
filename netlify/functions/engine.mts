import type { Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal, getCmeClockState } from "./lib/signal-mcl.mjs";
import { resolvePositionState, actionable, lifecycleLockActive, STRATEGY_VERSION } from "./lib/position-state.mjs";
import { sendAll } from "./lib/push.mjs";
import { updateSignalLog, appendDecisionSnapshot, repairKnownLedgerIncidents } from "./lib/signal-log.mjs";

function transitionTitle(currentSignal:any, previousSignal:any){
  if(currentSignal === "BUY MCL") return previousSignal === "SELL MCL" ? "MCL REVERSE → BUY" : "MCL BUY";
  if(currentSignal === "SELL MCL") return previousSignal === "BUY MCL" ? "MCL REVERSE → SELL" : "MCL SELL";
  if(previousSignal === "BUY MCL") return "MCL EXIT LONG";
  if(previousSignal === "SELL MCL") return "MCL EXIT SHORT";
  return "MCL WAIT";
}

async function sendTransitionAlerts(current:any, previousSignal:any){
  const title=transitionTitle(current.signal,previousSignal);
  let pushResult:any=null;
  try {
    pushResult=await sendAll({
      title,
      body:`MCL ${current.instrument?.symbol||""} $${current.price} · score ${current.score>0?"+":""}${current.score} · raw ${current.rawSignal||"WAIT"} · ${current.reason||"—"}`,
      tag:"mcl-live-signal",url:"/",kind:"signal",signal:current.signal,price:current.price,score:current.score,ts:Date.now()
    });
  } catch(error:any) {
    console.error("push alert failed",error);
  }
  return {pushResult,title};
}

export default async (_req:Request) => {
  const s=store("mcl-engine");
  const clock=getCmeClockState();

  // The cron runs Sunday-Friday in UTC. Skip network-heavy market-data work
  // whenever NYMEX energy futures are actually closed in Chicago time.
  if (!clock.session) {
    const previous:any=await s.get("state",{type:"json"}) || {};
    const lastStatus:any=await s.get("status",{type:"json"}) || {};

    // Keep the forward ledger continuous across strategy versions. Closed NYMEX
    // sessions flatten positions and clear any hard-exit lifecycle lockout.
    const flatCurrent:any={
      ...lastStatus,
      strategyVersion:STRATEGY_VERSION,
      rawSignal:"WAIT",
      rawReason:clock.reason || "NYMEX SESSION CLOSED",
      previousPosition:previous.signal || "WAIT",
      signal:"WAIT",
      positionEvent:actionable(previous.signal)?"EXIT":"FLAT",
      reason:clock.reason || "NYMEX SESSION CLOSED",
      checkedAt:new Date().toISOString(),
    };
    try { await updateSignalLog(flatCurrent); } catch(error:any) { console.error("signal log init/close failed",error); }
    if(actionable(previous.signal)){
      try { await appendDecisionSnapshot(flatCurrent); } catch(error:any) { console.error("decision log session-close update failed",error); }
    }

    if (actionable(previous.signal) && Number.isFinite(Number(lastStatus?.price))) {
      const alerts=await sendTransitionAlerts(flatCurrent,previous.signal);
      const listed=await store("mcl-push-subscriptions").list({prefix:"sub-"});
      const lastPush=alerts.pushResult?{at:flatCurrent.checkedAt,signal:"WAIT",title:alerts.title,result:alerts.pushResult}:previous.lastPush||null;
      const lastEmail=null;
      await s.setJSON("status",{...flatCurrent,lastPush,lastEmail,pushSubscribers:listed.blobs.length});
      await s.setJSON("state",{signal:"WAIT",rawSignal:"WAIT",strategyVersion:STRATEGY_VERSION,lastPush,lastEmail,pushSubscribers:listed.blobs.length,checkedAt:flatCurrent.checkedAt});
      return;
    }
    await s.setJSON("state",{...previous,signal:"WAIT",rawSignal:"WAIT",strategyVersion:STRATEGY_VERSION,riskLockDirection:null,checkedAt:flatCurrent.checkedAt});
    return;
  }

  let previous:any=await s.get("state",{type:"json"}) || {};
  let openTrade:any=null;
  try {
    const rawLedger:any=await s.get("signal-log",{type:"json"}) || {};
    const repaired=repairKnownLedgerIncidents(rawLedger);
    const ledger:any=repaired.ledger;
    if(repaired.repaired) await s.setJSON("signal-log",ledger);
    openTrade=Array.isArray(ledger?.trades)?ledger.trades.find((t:any)=>t?.status === "OPEN")||null:null;
    const ledgerSignal=actionable(openTrade?.direction)?openTrade.direction:null;
    const recoverySignal=repaired.restoredSignal || ledgerSignal;
    if(recoverySignal && !actionable(previous.signal)){
      previous={...previous,signal:recoverySignal,rawSignal:recoverySignal,riskLockDirection:null,incidentRecovery:"LEDGER_OPEN_POSITION"};
      await s.setJSON("state",previous);
    }
    const raw:any=await computeSignal();
    const previousRiskLock=previous.riskLockDirection||null;
    const current:any=resolvePositionState(raw,previous.signal,openTrade,previousRiskLock);
    const nextRiskLockDirection=current?.riskCap?.trigger
      ? (actionable(previous.signal)?previous.signal:null)
      : (lifecycleLockActive(raw,previousRiskLock)?previousRiskLock:null);
    const stateChanged=previous.signal !== current.signal;
    let lastPush=previous.lastPush||null;
    let lastEmail=previous.lastEmail||null;

    try { await updateSignalLog(current); } catch(error:any) { console.error("signal log update failed",error); }
    try { await appendDecisionSnapshot(current); } catch(error:any) { console.error("decision log update failed",error); }

    // Alert on entries, reversals, and true exits. Ordinary raw WAIT flicker while
    // a position is held does not create an alert or a new trade.
    if (stateChanged && (actionable(current.signal) || actionable(previous.signal))) {
      const alerts=await sendTransitionAlerts(current,previous.signal);
      if(alerts.pushResult) lastPush={at:new Date().toISOString(),signal:current.signal,title:alerts.title,result:alerts.pushResult};
      // MCL push-only alerts; email intentionally disabled.
    }

    const listed=await store("mcl-push-subscriptions").list({prefix:"sub-"});
    const state={
      signal:current.signal,
      rawSignal:current.rawSignal,
      strategyVersion:STRATEGY_VERSION,
      riskLockDirection:nextRiskLockDirection,
      lastPush,lastEmail,pushSubscribers:listed.blobs.length,checkedAt:current.checkedAt
    };
    await s.setJSON("state",state);
    await s.setJSON("status",{...current,riskLockDirection:nextRiskLockDirection,lastPush,lastEmail,pushSubscribers:listed.blobs.length});
  } catch(error:any) {
    console.error("engine error",error);
    const lastStatus:any=await s.get("status",{type:"json"}) || {};
    const held=actionable(previous.signal);
    const sideLabel=previous.signal==="BUY MCL"?"LONG":previous.signal==="SELL MCL"?"SHORT":"FLAT";
    const errorStatus:any={
      ...lastStatus,
      signal:held?previous.signal:"WAIT",
      rawSignal:"WAIT",
      rawReason:"ENGINE DATA ERROR",
      strategyVersion:STRATEGY_VERSION,
      positionEvent:held?"HOLD":"FLAT",
      reason:held?`HOLD ${sideLabel} · ENGINE DATA ERROR`:"ENGINE ERROR",
      error:error?.message||String(error),
      checkedAt:new Date().toISOString(),
      market:{
        ...(lastStatus?.market||{}),
        session:clock.session,
        inEntry:clock.inEntry,
        firstFive:clock.firstFive,
        sessionKey:clock.sessionKey,
        feedActive:false
      },
      clock:{label:clock.label,reason:clock.reason},
      lastPush:previous.lastPush||lastStatus?.lastPush||null,
      lastEmail:previous.lastEmail||lastStatus?.lastEmail||null,
      pushSubscribers:previous.pushSubscribers??lastStatus?.pushSubscribers??null
    };
    await s.setJSON("status",errorStatus);
    try { await appendDecisionSnapshot(errorStatus); } catch(logError:any) { console.error("decision log engine-error update failed",logError); }
  }
};

// Run every minute Sunday-Friday. getCmeClockState() cheaply skips the normal
// 16:00-17:00 CT maintenance break and all other closed periods.
export const config:Config={schedule:"* * * * 0-5"};
