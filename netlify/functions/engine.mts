import type { Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal, getCmeClockState } from "./lib/signal-nq.mjs";
import { sendAll } from "./lib/push.mjs";
import { sendSignalEmail } from "./lib/email.mjs";
import { updateSignalLog } from "./lib/signal-log.mjs";

export default async (_req:Request) => {
  const s=store("mnq-engine");
  const clock=getCmeClockState();

  // The cron runs Sunday-Friday in UTC. Skip network-heavy market-data work
  // whenever CME equity-index futures are actually closed in Chicago time.
  if (!clock.session) {
    const previous:any=await s.get("state",{type:"json"}) || {};
    if (previous.signal && previous.signal!=="WAIT") {
      const lastStatus:any=await s.get("status",{type:"json"}) || {};
      if(Number.isFinite(Number(lastStatus?.price))){
        try {
          await updateSignalLog({
            ...lastStatus,
            signal:"WAIT",
            reason:clock.reason || "CME SESSION CLOSED",
            checkedAt:new Date().toISOString(),
          });
        } catch(error:any) {
          console.error("signal log close failed",error);
        }
      }
      await s.setJSON("state",{...previous,signal:"WAIT",checkedAt:new Date().toISOString()});
    }
    return;
  }

  try {
    const current:any=await computeSignal();
    const previous:any=await s.get("state",{type:"json"}) || {};
    const actionable=current.signal==="BUY MNQ"||current.signal==="SELL MNQ";
    let pushResult:any=null;
    let emailResult:any=null;
    let lastPush=previous.lastPush||null;
    let lastEmail=previous.lastEmail||null;

    try {
      await updateSignalLog(current);
    } catch(error:any) {
      console.error("signal log update failed",error);
    }

    if (actionable && previous.signal!==current.signal) {
      try {
        pushResult=await sendAll({
          title:current.signal==="BUY MNQ"?"MNQ BUY":"MNQ SELL",
          body:`NQ ${current.instrument?.symbol||""} $${current.price} · score ${current.score>0?"+":""}${current.score} · ${current.frames["30m"].state}/${current.frames["15m"].state}/${current.frames["5m"].state}/${current.frames["1m"].state}`,
          tag:"mnq-live-signal",url:"/",kind:"signal",signal:current.signal,price:current.price,score:current.score,ts:Date.now()
        });
        lastPush={at:new Date().toISOString(),signal:current.signal,result:pushResult};
      } catch(error:any) {
        console.error("push alert failed",error);
      }

      try {
        emailResult=await sendSignalEmail(current);
        lastEmail={at:new Date().toISOString(),signal:current.signal,id:emailResult?.id||null};
      } catch(error:any) {
        console.error("email alert failed",error);
      }
    }

    const listed=await store("mnq-push-subscriptions").list({prefix:"sub-"});
    const state={signal:current.signal,lastPush,lastEmail,pushSubscribers:listed.blobs.length,checkedAt:current.checkedAt};
    await s.setJSON("state",state);
    await s.setJSON("status",{...current,lastPush,lastEmail,pushSubscribers:listed.blobs.length});
  } catch(error:any) {
    console.error("engine error",error);
    const previous:any=await s.get("state",{type:"json"}) || {};
    await s.setJSON("status",{
      signal:"WAIT",
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
