import type { Context, Config } from "@netlify/functions";

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-premium-vertex/1.0";

let tokenCache: { value: string; until: number } | null = null;
let tokenRequest: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const clientSecret = (Netlify.env.get("TASTY_CLIENT_SECRET") || "").trim();
    const refreshToken = (Netlify.env.get("TASTY_REFRESH_TOKEN") || "").trim();
    if (!clientSecret || !refreshToken) throw new Error("Tastytrade credentials missing from Netlify");
    const res = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({grant_type:"refresh_token",refresh_token:refreshToken,client_secret:clientSecret}),
      signal: AbortSignal.timeout(8000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.access_token) {
      throw new Error(res.status === 400 || res.status === 401
        ? `Tastytrade authentication rejected (${res.status}); verify the OAuth grant and client secret`
        : `Tastytrade authentication failed (HTTP ${res.status})`);
    }
    const token = String(body.access_token);
    const expires = Number(body.expires_in);
    tokenCache = { value: token, until: Date.now() + Math.max(60, Math.min(Number.isFinite(expires) && expires > 0 ? expires : 900, 900) - 90) * 1000 };
    return token;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
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
    quoteUrl.searchParams.set("equity", ticker);

    const quoteRes = await fetch(quoteUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(9000),
    });

    const quoteBody: any = await quoteRes.json().catch(() => ({}));
    const quote = quoteBody?.data?.items?.[0] || null;

    if (!quoteRes.ok || !quote) {
      return Response.json({
        ok: false,
        ticker,
        httpStatus: quoteRes.status,
        error: quoteRes.status === 403 ? "Tastytrade market-data permission denied (403); check account eligibility" : quoteRes.status === 429 ? "Tastytrade quote rate limit (429); retry shortly" : quoteBody?.error?.message || quoteBody?.message || `Quote unavailable (HTTP ${quoteRes.status})`,
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
      error: error?.name === "TimeoutError" ? "Tastytrade quote request timed out" : error?.message || "unexpected_error",
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
};

export const config: Config = { path: "/api/equity-quote" };
