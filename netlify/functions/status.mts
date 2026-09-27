import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal } from "./lib/signal-nq.mjs";
import { resolvePositionState, STRATEGY_VERSION } from "./lib/position-state.mjs";

export default async (_req: Request, _context: Context) => {
  const s = store("mnq-engine");
  let status:any = await s.get("status", { type:"json" });
  const stale = !status?.checkedAt || (Date.now() - Date.parse(status.checkedAt)) > 95_000;
  if (!status || stale) {
    try {
      const prior:any = await s.get("state", { type:"json" }) || {};
      const raw:any = await computeSignal();
      status = resolvePositionState(raw, prior.signal);
      status.lastPush = prior?.lastPush || null;
      status.lastEmail = prior?.lastEmail || null;
      status.pushSubscribers = prior?.pushSubscribers ?? null;
      status.strategyVersion = STRATEGY_VERSION;
      await s.setJSON("status", status);
    } catch (error:any) {
      status = { signal:"WAIT", rawSignal:"WAIT", strategyVersion:STRATEGY_VERSION, reason:"ENGINE ERROR", error:error?.message || String(error), checkedAt:new Date().toISOString() };
    }
  }
  return Response.json(status, { headers:{"Cache-Control":"no-store"} });
};
export const config: Config = { path:"/api/status" };
