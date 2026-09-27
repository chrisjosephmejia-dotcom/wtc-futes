import type { Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal, getCmeClockState } from "./lib/signal-nq.mjs";
import { resolvePositionState, actionable, STRATEGY_VERSION } from "./lib/position-state.mjs";
import { sendAll } from "./lib/push.mjs";
import { sendSignalEmail } from "./lib/email.mjs";
import { updateSignalLog, appendDecisionSnapshot } from "./lib/signal-log.mjs";

function transitionTitle(currentSignal:any, previousSignal:any){
  if(currentSignal === "BUY MNQ") return previousSignal === "SELL MNQ" ? "MNQ REVERSE → BUY" : "MNQ BUY";
  if(currentSignal === "SELL MNQ") return previousSignal === "BUY MNQ" ? "MNQ REVERSE → SELL" : "MNQ SELL";
  if(previousSignal === "BUY MNQ") return "MNQ EXIT LONG";
  if(previousSignal === "SELL MNQ") return "MNQ EXIT SHORT";
  return "MNQ WAIT";
}

async function sendTransitionAlerts(current:any, previousSignal:any){
  const title=transitionTitle(current.signal,previousSignal);
  let pushResult:any=null;
  let emailResult:any=null;
  try {
    pushResult=await sendAll({
      title,
      body:`NQ ${current.instrument?.symbol||""} $${current.price} · score ${current.score>0?"+":""}${current.score} · raw ${current.rawSignal||"WAIT"} · ${current.reason||"—"}`,
      tag:"mnq-live-signal",url:"/",kind:"signal",signal:current.signal,price:current.price,score:current.score,ts:Date.now()
    });
  } catch(error:any) {
    console.error("push alert failed",error);
  }
  try {
    emailResult=await sendSignalEmail(current,previousSignal);
  } catch(error:any) {
    console.error("email alert failed",error);
  }
  return {pushResult,emailResult,title};
}

export default async (_req:Request) => {
  const s=store("mnq-engine");
  const clock=getCmeClockState();

  // The cron runs Sunday-Friday in UTC. Skip network-heavy market-data work
  // whenever CME equity-index futures are actually closed in Chicago time.
  if (!clock.session) {
    const previous:any=await s.get("state",{type:"json"}) || {};
    if (actionable(previous.signal)) {
      const lastStatus:any=await s.get("status",{type:"json"}) || {};
      if(Number.isFinite(Number(lastStatus?.price))){
        const current={
          ...lastStatus,
          strategyVersion:STRATEGY_VERSION,
          rawSignal:"WAIT",
          rawReason:clock.reason || "CME SESSION CLOSED",
          previousPosition:previous.signal,
          signal:"WAIT",
          positionEvent:"EXIT",
          reason:clock.reason || "CME SESSION CLOSED",
          checkedAt:new Date().toISOString(),
        };
        try { await updateSignalLog(current); } catch(error:any) { console.error("signal log close failed",error); }
        const alerts=await sendTransitionAlerts(current,previous.signal);
        const listed=await store("mnq-push-subscriptions").list({prefix:"sub-"});
        const lastPush=alerts.pushResult?{at:current.checkedAt,signal:"WAIT",title:alerts.title,result:alerts.pushResult}:previous.lastPush||null;
        const lastEmail=alerts.emailResult?{at:current.checkedAt,signal:"WAIT",title:alerts.title,id:alerts.emailResult?.id||null}:previous.lastEmail||null;
        await s.setJSON("status",{...current,lastPush,lastEmail,pushSubscribers:listed.blobs.length});
        await s.setJSON("state",{signal:"WAIT",rawSignal:"WAIT",strategyVersion:STRATEGY_VERSION,lastPush,lastEmail,pushSubscribers:listed.blobs.length,checkedAt:current.checkedAt});
        return;
      }
    }
    await s.setJSON("state",{...previous,signal:"WAIT",rawSignal:"WAIT",strategyVersion:STRATEGY_VERSION,checkedAt:new Date().toISOString()});
    return;
  }

  try {
    const raw:any=await computeSignal();
    const previous:any=await s.get("state",{type:"json"}) || {};
    const current:any=resolvePositionState(raw,previous.signal);
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
      if(alerts.emailResult) lastEmail={at:new Date().toISOString(),signal:current.signal,title:alerts.title,id:alerts.emailResult?.id||null};
    }

    const listed=await store("mnq-push-subscriptions").list({prefix:"sub-"});
    const state={
      signal:current.signal,
      rawSignal:current.rawSignal,
      strategyVersion:STRATEGY_VERSION,
      lastPush,lastEmail,pushSubscribers:listed.blobs.length,checkedAt:current.checkedAt
    };
    await s.setJSON("state",state);
    await s.setJSON("status",{...current,lastPush,lastEmail,pushSubscribers:listed.blobs.length});
  } catch(error:any) {
    console.error("engine error",error);
    const previous:any=await s.get("state",{type:"json"}) || {};
    await s.setJSON("status",{
      signal:"WAIT",
      rawSignal:"WAIT",
      strategyVersion:STRATEGY_VERSION,
      reason:"ENGINE ERROR",
      error:error?.message||String(error),
      checkedAt:new Date().toISOString(),
      lastPush:previous.lastPush||null,
      lastEmail:previous.lastEmail||null,
      pushSubscribers:previous.pushSubscribers??null
    });
  }
};

// Run every minute Sunday-Friday. getCmeClockState() cheaply skips the normal
// 16:00-17:00 CT maintenance break and all other closed periods.
export const config:Config={schedule:"* * * * 0-5"};
