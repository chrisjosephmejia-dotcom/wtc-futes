import type { Context, Config } from "@netlify/functions";

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-premium-vertex/1.0";

async function getAccessToken() {
  const clientSecret = (Netlify.env.get("TASTY_CLIENT_SECRET") || "").trim();
  const refreshToken = (Netlify.env.get("TASTY_REFRESH_TOKEN") || "").trim();

  if (!clientSecret || !refreshToken) {
    throw new Error("Tastytrade credentials are not configured");
  }

  const res = await fetch(`${BASE}/oauth/token`, {
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

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    throw new Error(`Tastytrade OAuth failed (${res.status})`);
  }

  return body.access_token as string;
}

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "SPY").trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
      return Response.json({ ok: false, error: "invalid_ticker" }, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const accessToken = await getAccessToken();
    const quoteUrl = new URL(`${BASE}/market-data/by-type`);
    quoteUrl.searchParams.append("equity[]", ticker);

    const quoteRes = await fetch(quoteUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
    });

    const quoteBody: any = await quoteRes.json().catch(() => ({}));
    const quote = quoteBody?.data?.items?.[0] || null;

    if (!quoteRes.ok || !quote) {
      return Response.json({
        ok: false,
        ticker,
        httpStatus: quoteRes.status,
        error: quoteBody?.error?.message || quoteBody?.message || "quote_unavailable",
      }, {
        status: quoteRes.ok ? 502 : quoteRes.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const bid = quote?.bid != null ? Number(quote.bid) : null;
    const ask = quote?.ask != null ? Number(quote.ask) : null;
    const mid = quote?.mid != null
      ? Number(quote.mid)
      : bid != null && ask != null
        ? (bid + ask) / 2
        : null;

    return Response.json({
      ok: true,
      source: "tastytrade",
      feed: "real-time REST",
      ticker,
      updatedAt: quote?.["updated-at"] || quote?.updatedAt || null,
      receivedAt: new Date().toISOString(),
      bid,
      bidSize: quote?.["bid-size"] != null ? Number(quote["bid-size"]) : null,
      ask,
      askSize: quote?.["ask-size"] != null ? Number(quote["ask-size"]) : null,
      mid,
      mark: quote?.mark != null ? Number(quote.mark) : null,
      last: quote?.last != null ? Number(quote.last) : null,
      lastMarket: quote?.["last-mkt"] != null ? Number(quote["last-mkt"]) : null,
      open: quote?.open != null ? Number(quote.open) : null,
      dayHigh: quote?.["day-high-price"] != null ? Number(quote["day-high-price"]) : null,
      dayLow: quote?.["day-low-price"] != null ? Number(quote["day-low-price"]) : null,
      previousClose: quote?.["prev-close"] != null ? Number(quote["prev-close"]) : null,
      volume: quote?.volume != null ? Number(quote.volume) : null,
      halted: quote?.["is-trading-halted"] ?? null,
    }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: error?.message || "unexpected_error",
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
};

export const config: Config = { path: "/api/equity-quote" };
