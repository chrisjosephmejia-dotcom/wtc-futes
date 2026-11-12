// Read-only price verification, independent of the DXLink candle engine.
// Use tastytrade's snapshot endpoint for display rather than opening a new
// WebSocket on every browser poll (which previously timed out after 8 seconds).
const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-mcl/1.0";
const MAX_QUOTE_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

async function getAccessToken() {
  const clientSecret = Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken = Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if (!clientSecret || !refreshToken) throw new Error("Missing tastytrade environment variables");
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body: any = await readJson(res);
  if (!res.ok || !body?.access_token) throw new Error(`tastytrade OAuth ${res.status}`);
  return body.access_token as string;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT, Accept: "application/json" };
}

async function getActiveMcl(accessToken: string) {
  const url = new URL(`${BASE}/instruments/futures`);
  url.searchParams.set("only-active-futures", "true");
  url.searchParams.set("per-page", "50");
  url.searchParams.append("product-code[]", "MCL");
  const res = await fetch(url, { headers: headers(accessToken), signal: AbortSignal.timeout(8_000) });
  const body: any = await readJson(res);
  const items: any[] = body?.data?.items || [];
  if (!res.ok || !items.length) throw new Error(`MCL instrument lookup failed (${res.status})`);
  const tradeable = items.filter((x) => x?.["is-tradeable"] !== false && x?.active !== false);
  const active = tradeable.find((x) => x?.["active-month"] === true);
  const sorted = [...tradeable].sort((a, b) =>
    Date.parse(a?.["stops-trading-at"] || a?.["expires-at"] || "9999-12-31") -
    Date.parse(b?.["stops-trading-at"] || b?.["expires-at"] || "9999-12-31"));
  const future = active || sorted[0] || items[0];
  if (!future?.symbol) throw new Error("Active MCL symbol missing");
  return future;
}

export function validateQuote(quote: any, now = Date.now()) {
  const price = Number(quote?.last ?? quote?.mark ?? quote?.mid);
  const rawTime = quote?.updatedAt ?? quote?.["updated-at"];
  const quoteTime = rawTime ? Date.parse(rawTime) : NaN;
  if (!Number.isFinite(price) || price <= 0) throw new Error("MCL REST quote has no valid price");
  if (!Number.isFinite(quoteTime)) throw new Error("MCL REST quote has no update timestamp");
  const ageMs = now - quoteTime;
  if (ageMs < -MAX_FUTURE_SKEW_MS) throw new Error("MCL REST quote timestamp is in the future");
  if (ageMs > MAX_QUOTE_AGE_MS) throw new Error(`MCL REST quote is stale (${Math.round(ageMs / 1000)}s)`);
  return { price, quoteTime: new Date(quoteTime).toISOString(), ageSec: Math.max(0, Math.round(ageMs / 1000)) };
}

export async function getLiveMclPrice() {
  const accessToken = await getAccessToken();
  const future = await getActiveMcl(accessToken);
  const url = new URL(`${BASE}/market-data/by-type`);
  url.searchParams.append("future[]", future.symbol);
  const res = await fetch(url, { headers: headers(accessToken), signal: AbortSignal.timeout(8_000) });
  const body: any = await readJson(res);
  if (!res.ok) throw new Error(`tastytrade REST futures quote HTTP ${res.status}`);
  const quotes: any[] = body?.data?.items || [];
  const quote = quotes.find((item) => item?.symbol === future.symbol) || quotes[0];
  if (!quote) throw new Error("No MCL REST quote returned");
  const checkedAt = new Date().toISOString();
  const fresh = validateQuote(quote);
  return {
    symbol: future.symbol as string,
    streamerSymbol: future["streamer-symbol"] || null,
    exchange: future.exchange || "NYMEX",
    expirationDate: future["expiration-date"] || null,
    ...fresh,
    checkedAt,
    source: "tastytrade REST /market-data/by-type",
    verified: true,
  };
}
