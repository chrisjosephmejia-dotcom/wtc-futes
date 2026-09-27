import type { Context, Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { computeSignal } from "./lib/signal-nq.mjs";

export default async (_req: Request, _context: Context) => {
  const s = store("mnq-engine");
  let status:any = await s.get("status", { type:"json" });
  const stale = !status?.checkedAt || (Date.now() - Date.parse(status.checkedAt)) > 95_000;
  if (!status || stale) {
    try {
      status = await computeSignal();
      const prior:any = await s.get("state", { type:"json" });
      status.lastPush = prior?.lastPush || null;
      status.pushSubscribers = prior?.pushSubscribers ?? null;
      await s.setJSON("status", status);
    } catch (error:any) {
      status = { signal:"WAIT", reason:"ENGINE ERROR", error:error?.message || String(error), checkedAt:new Date().toISOString() };
    }
  }
  return Response.json(status, { headers:{"Cache-Control":"no-store"} });
};
export const config: Config = { path:"/api/status" };
