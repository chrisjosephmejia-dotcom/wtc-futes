import type { Config } from "@netlify/functions";
import { computeSignal } from "./lib/signal-nq.mjs";

export default async () => {
  try {
    const signal = await computeSignal();
    return Response.json({
      ok:true,
      signal:signal.signal,
      reason:signal.reason,
      price:signal.price,
      source:signal.source,
      instrument:signal.instrument,
      market:signal.market,
      daily:signal.daily,
      frames:signal.frames,
      score:signal.score,
      vwap:signal.vwap,
      openingRange:signal.openingRange,
    }, { headers:{"Cache-Control":"no-store"} });
  } catch (error:any) {
    return Response.json({ok:false,error:error?.message||String(error)}, {status:500,headers:{"Cache-Control":"no-store"}});
  }
};

export const config:Config={path:"/api/nq-signal-test"};
