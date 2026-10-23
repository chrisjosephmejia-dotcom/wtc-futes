import type { Context, Config } from "@netlify/functions";
import { getLiveMclPrice } from "./lib/live-nq.mjs";

export default async (_req: Request, _context: Context) => {
  try {
    const quote = await getLiveMclPrice();
    return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || String(error), checkedAt: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const config: Config = { path: "/api/live-price" };
