import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal, getCmeClockState } from "./lib/signal-nq.mjs";
import { resolvePositionState, actionable, STRATEGY_VERSION } from "./lib/position-state.mjs";
import { repairKnownLedgerIncidents } from "./lib/signal-log.mjs";

export default async (_req: Request, _context: Context) => {
  const s = store("mcl-engine");
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
      const ledgerSignal=actionable(openTrade?.direction)?openTrade.direction:null;
      const recoverySignal=repaired.restoredSignal || ledgerSignal;
      if(recoverySignal && !actionable(prior.signal)){
        prior={...prior,signal:recoverySignal,rawSignal:recoverySignal,riskLockDirection:null,incidentRecovery:"LEDGER_OPEN_POSITION"};
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
      const held=actionable(prior?.signal);
      const sideLabel=prior?.signal==="BUY MCL"?"LONG":prior?.signal==="SELL MCL"?"SHORT":"FLAT";
      status = {
        ...(status||{}),
        signal:held?prior.signal:"WAIT",
        rawSignal:"WAIT",
        strategyVersion:STRATEGY_VERSION,
        positionEvent:held?"HOLD":"FLAT",
        reason:held?`HOLD ${sideLabel} · ENGINE DATA ERROR`:"ENGINE ERROR",
        error:error?.message || String(error),
        checkedAt:new Date().toISOString(),
        market:{
          ...(status?.market||{}),
          session:clock.session,
          inEntry:clock.inEntry,
          firstFive:clock.firstFive,
          sessionKey:clock.sessionKey,
          feedActive:false
        },
        clock:{label:clock.label,reason:clock.reason},
        lastPush:prior?.lastPush||status?.lastPush||null,
        lastEmail:prior?.lastEmail||status?.lastEmail||null,
        pushSubscribers:prior?.pushSubscribers??status?.pushSubscribers??null
      };
    }
  }
  return Response.json(status, { headers:{"Cache-Control":"no-store"} });
};
export const config: Config = { path:"/api/status" };
