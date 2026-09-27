import type { Context, Config } from "@netlify/functions";

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-futes/1.0";

function safeErrorBody(body: any) {
  return {
    code: body?.error?.code || body?.code || null,
    message: body?.error?.message || body?.message || null,
  };
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

export default async (_req: Request, _context: Context) => {
  const clientSecret = Netlify.env.get("TASTY_CLIENT_SECRET");
  const refreshToken = Netlify.env.get("TASTY_REFRESH_TOKEN");

  if (!clientSecret || !refreshToken) {
    return Response.json({
      ok: false,
      auth: { ok: false, reason: "missing_environment_variables" },
      hasClientSecret: Boolean(clientSecret),
      hasRefreshToken: Boolean(refreshToken),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
    }),
  });
  const tokenBody: any = await readJson(tokenRes);

  if (!tokenRes.ok || !tokenBody?.access_token) {
    return Response.json({
      ok: false,
      auth: { ok: false, httpStatus: tokenRes.status, ...safeErrorBody(tokenBody) },
      instrument: { ok: false },
      marketData: { ok: false },
    }, { status: tokenRes.status || 500, headers: { "Cache-Control": "no-store" } });
  }

  const accessToken = tokenBody.access_token as string;
  const apiHeaders = {
    "Authorization": `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
  };

  const futuresUrl = new URL(`${BASE}/instruments/futures`);
  futuresUrl.searchParams.set("only-active-futures", "true");
  futuresUrl.searchParams.set("per-page", "50");
  futuresUrl.searchParams.append("product-code[]", "NQ");

  const futuresRes = await fetch(futuresUrl, { headers: apiHeaders });
  const futuresBody: any = await readJson(futuresRes);
  const items: any[] = futuresBody?.data?.items || [];

  if (!futuresRes.ok || !items.length) {
    return Response.json({
      ok: false,
      auth: { ok: true },
      instrument: {
        ok: false,
        httpStatus: futuresRes.status,
        count: items.length,
        ...safeErrorBody(futuresBody),
      },
      marketData: { ok: false },
    }, { status: futuresRes.ok ? 502 : futuresRes.status, headers: { "Cache-Control": "no-store" } });
  }

  const tradeable = items.filter((x) => x?.["is-tradeable"] !== false && x?.active !== false);
  const activeMonth = tradeable.find((x) => x?.["active-month"] === true);
  const sorted = [...tradeable].sort((a, b) => {
    const at = Date.parse(a?.["stops-trading-at"] || a?.["expires-at"] || "9999-12-31");
    const bt = Date.parse(b?.["stops-trading-at"] || b?.["expires-at"] || "9999-12-31");
    return at - bt;
  });
  const future = activeMonth || sorted[0] || items[0];
  const symbol = future?.symbol;

  if (!symbol) {
    return Response.json({
      ok: false,
      auth: { ok: true },
      instrument: { ok: false, reason: "nq_symbol_missing", count: items.length },
      marketData: { ok: false },
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const quoteUrl = new URL(`${BASE}/market-data/by-type`);
  quoteUrl.searchParams.append("future[]", symbol);
  const quoteRes = await fetch(quoteUrl, { headers: apiHeaders });
  const quoteBody: any = await readJson(quoteRes);
  const quote = quoteBody?.data?.items?.[0] || null;

  const response = {
    ok: quoteRes.ok && Boolean(quote),
    auth: { ok: true },
    instrument: {
      ok: true,
      symbol,
      activeMonth: future?.["active-month"] ?? null,
      nextActiveMonth: future?.["next-active-month"] ?? null,
      streamerSymbol: future?.["streamer-symbol"] || null,
      exchange: future?.exchange || null,
      expirationDate: future?.["expiration-date"] || null,
      stopsTradingAt: future?.["stops-trading-at"] || null,
      tickSize: future?.["tick-size"] || null,
    },
    marketData: quoteRes.ok && quote ? {
      ok: true,
      httpStatus: quoteRes.status,
      updatedAt: quote?.updatedAt || quote?.["updated-at"] || null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      mid: quote?.mid ?? null,
      mark: quote?.mark ?? null,
      last: quote?.last ?? null,
      volume: quote?.volume ?? null,
    } : {
      ok: false,
      httpStatus: quoteRes.status,
      fundedAccountRequired: quoteRes.status === 403,
      ...safeErrorBody(quoteBody),
    },
  };

  return Response.json(response, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
};

export const config: Config = { path: "/api/tasty-status" };
