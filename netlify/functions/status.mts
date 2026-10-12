import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal, getCmeClockState } from "./lib/signal-nq.mjs";
import { resolvePositionState, actionable, STRATEGY_VERSION } from "./lib/position-state.mjs";
import { repairKnownLedgerIncidents } from "./lib/signal-log.mjs";

export default async (_req: Request, _context: Context) => {
  const s = store("mnq-engine");
  let status:any = await s.get("status", { type:"json" });
  const stale = !status?.checkedAt || (Date.now() - Date.parse(status.checkedAt)) > 95_000;
  if (!status || stale) {
    try {
      let prior:any = await s.get("state", { type:"json" }) || {};
      const rawLedger:any=await s.get("signal-log",{type:"json"}) || {};
      const repaired=repairKnownLedgerIncidents(rawLedger);
      const ledger:any=repaired.ledger;
      if(repaired.repaired) await s.setJSON("signal-log",ledger);
      const openTrade=Array.isArray(ledger?.trades)?ledger.trades.find((t:any)=>t?.status === "OPEN")||null:null;
      if(repaired.restoredSignal && !actionable(prior.signal)){
        prior={...prior,signal:repaired.restoredSignal,rawSignal:repaired.restoredSignal,riskLockDirection:null,incidentRecovery:"STALE_FEED_2026-10-11"};
        await s.setJSON("state",prior);
      }
      const raw:any = await computeSignal();
      status = resolvePositionState(raw, prior.signal, openTrade, prior.riskLockDirection||null);
      status.lastPush = prior?.lastPush || null;
      status.lastEmail = prior?.lastEmail || null;
      status.pushSubscribers = prior?.pushSubscribers ?? null;
      status.strategyVersion = STRATEGY_VERSION;
      await s.setJSON("status", status);
    } catch (error:any) {
      const clock=getCmeClockState();
      status = {
        signal:"WAIT",
        rawSignal:"WAIT",
        strategyVersion:STRATEGY_VERSION,
        reason:"ENGINE ERROR",
        error:error?.message || String(error),
        checkedAt:new Date().toISOString(),
        market:{
          session:clock.session,
          inEntry:clock.inEntry,
          firstFive:clock.firstFive,
          sessionKey:clock.sessionKey,
          feedActive:false,
          lastBarLabel:null
        },
        clock:{label:clock.label,reason:clock.reason}
      };
    }
  }
  return Response.json(status, { headers:{"Cache-Control":"no-store"} });
};
export const config: Config = { path:"/api/status" };
