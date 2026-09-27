import type { Context, Config } from "@netlify/functions";
import WebSocket from "ws";

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-futes/1.0";
const TZ = "America/Chicago";

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeErrorBody(body: any) {
  return {
    code: body?.error?.code || body?.code || null,
    message: body?.error?.message || body?.message || null,
  };
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

function ctLabel(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms)) + " CT";
}

async function getAccessToken() {
  const clientSecret = Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken = Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if (!clientSecret || !refreshToken) throw new Error("Missing tastytrade environment variables");

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
  const body: any = await readJson(res);
  if (!res.ok || !body?.access_token) {
    const e = safeErrorBody(body);
    throw new Error(`OAuth ${res.status}: ${e.message || e.code || "token request failed"}`);
  }
  return body.access_token as string;
}

async function getActiveNq(accessToken: string) {
  const url = new URL(`${BASE}/instruments/futures`);
  url.searchParams.set("only-active-futures", "true");
  url.searchParams.set("per-page", "50");
  url.searchParams.append("product-code[]", "NQ");

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });
  const body: any = await readJson(res);
  const items: any[] = body?.data?.items || [];
  if (!res.ok || !items.length) throw new Error(`NQ instrument lookup failed (${res.status})`);

  const tradeable = items.filter((x) => x?.["is-tradeable"] !== false && x?.active !== false);
  const activeMonth = tradeable.find((x) => x?.["active-month"] === true);
  const sorted = [...tradeable].sort((a, b) => {
    const at = Date.parse(a?.["stops-trading-at"] || a?.["expires-at"] || "9999-12-31");
    const bt = Date.parse(b?.["stops-trading-at"] || b?.["expires-at"] || "9999-12-31");
    return at - bt;
  });
  const future = activeMonth || sorted[0] || items[0];
  if (!future?.symbol || !future?.["streamer-symbol"]) throw new Error("Active NQ streamer symbol missing");
  return future;
}

async function getQuoteToken(accessToken: string) {
  const res = await fetch(`${BASE}/api-quote-tokens`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });
  const body: any = await readJson(res);
  const data = body?.data;
  if (!res.ok || !data?.token || !data?.["dxlink-url"]) {
    const e = safeErrorBody(body);
    throw new Error(`Quote token ${res.status}: ${e.message || e.code || "request failed"}`);
  }
  return data;
}

type Candle = {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  vwap: number | null;
  count: number | null;
};

async function fetchCandles(dxlinkUrl: string, quoteToken: string, streamerSymbol: string) {
  const candleSymbol = `${streamerSymbol}{=1m}`;
  const fromTime = Date.now() - 96 * 60 * 60 * 1000;
  const requestedFields = [
    "eventType", "eventSymbol", "eventFlags", "time", "sequence", "count",
    "open", "high", "low", "close", "volume", "vwap"
  ];

  return await new Promise<{ candles: Candle[]; messages: number; candleSymbol: string; fromTime: number }>((resolve, reject) => {
    const ws = new WebSocket(dxlinkUrl);
    const candles = new Map<number, Candle>();
    let messages = 0;
    let subscribed = false;
    let eventFields: string[] = requestedFields;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const hardTimer = setTimeout(() => finish(), 8000);

    const cleanup = () => {
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      try { ws.close(); } catch {}
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const finish = () => {
      if (settled) return;
      if (!candles.size) return fail(new Error("DXLink connected but no NQ candle data arrived before timeout"));
      settled = true;
      cleanup();
      const rows = [...candles.values()].sort((a, b) => a.time - b.time);
      resolve({ candles: rows, messages, candleSymbol, fromTime });
    };

    const scheduleFinish = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (candles.size >= 5) finish();
      }, 900);
    };

    const send = (obj: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    ws.on("open", () => {
      send({
        type: "SETUP",
        channel: 0,
        version: "0.1-DXF-JS/0.3.0",
        keepaliveTimeout: 60,
        acceptKeepaliveTimeout: 60,
      });
    });

    ws.on("error", (err) => fail(new Error(`DXLink WebSocket error: ${String((err as any)?.message || err)}`)));

    ws.on("message", (raw) => {
      messages += 1;
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg?.type === "AUTH_STATE" && msg?.state === "UNAUTHORIZED") {
        send({ type: "AUTH", channel: 0, token: quoteToken });
        return;
      }

      if (msg?.type === "AUTH_STATE" && msg?.state === "AUTHORIZED") {
        send({ type: "CHANNEL_REQUEST", channel: 3, service: "FEED", parameters: { contract: "AUTO" } });
        return;
      }

      if (msg?.type === "AUTH_STATE" && msg?.state && msg.state !== "AUTHORIZED" && msg.state !== "UNAUTHORIZED") {
        fail(new Error(`DXLink authorization state: ${msg.state}`));
        return;
      }

      if (msg?.type === "CHANNEL_OPENED" && msg?.channel === 3) {
        send({
          type: "FEED_SETUP",
          channel: 3,
          acceptAggregationPeriod: 0.1,
          acceptDataFormat: "COMPACT",
          acceptEventFields: { Candle: requestedFields },
        });
        return;
      }

      if (msg?.type === "FEED_CONFIG" && msg?.channel === 3) {
        const negotiated = msg?.eventFields?.Candle;
        if (Array.isArray(negotiated) && negotiated.length) eventFields = negotiated;
        if (!subscribed) {
          subscribed = true;
          send({
            type: "FEED_SUBSCRIPTION",
            channel: 3,
            reset: true,
            add: [{ type: "Candle", symbol: candleSymbol, fromTime }],
          });
        }
        return;
      }

      if (msg?.type === "FEED_DATA" && msg?.channel === 3 && Array.isArray(msg?.data)) {
        let currentType = "";
        for (const item of msg.data) {
          if (typeof item === "string") {
            currentType = item;
            continue;
          }
          if (currentType !== "Candle" || !Array.isArray(item)) continue;
          const row: Record<string, any> = {};
          for (let i = 0; i < eventFields.length; i++) row[eventFields[i]] = item[i];
          const t = Number(row.time);
          if (!Number.isFinite(t) || t <= 0) continue;
          candles.set(t, {
            time: t,
            open: asNumber(row.open),
            high: asNumber(row.high),
            low: asNumber(row.low),
            close: asNumber(row.close),
            volume: asNumber(row.volume),
            vwap: asNumber(row.vwap),
            count: asNumber(row.count),
          });
        }
        if (candles.size) scheduleFinish();
      }
    });
  });
}

export default async (_req: Request, _context: Context) => {
  try {
    const accessToken = await getAccessToken();
    const [future, quoteAuth] = await Promise.all([
      getActiveNq(accessToken),
      getQuoteToken(accessToken),
    ]);

    const streamerSymbol = future["streamer-symbol"] as string;
    const result = await fetchCandles(quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol);
    const usable = result.candles.filter((c) => c.open !== null && c.high !== null && c.low !== null && c.close !== null);
    const last = usable.slice(-10).map((c) => ({
      time: new Date(c.time).toISOString(),
      timeCT: ctLabel(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      vwap: c.vwap,
      count: c.count,
    }));

    return Response.json({
      ok: usable.length > 0,
      auth: { ok: true },
      instrument: {
        ok: true,
        symbol: future.symbol,
        streamerSymbol,
        exchange: future.exchange || null,
        expirationDate: future["expiration-date"] || null,
      },
      dxlink: {
        ok: usable.length > 0,
        entitlementLevel: quoteAuth.level || null,
        quoteTokenExpiresAt: quoteAuth["expires-at"] || null,
        candleSymbol: result.candleSymbol,
        requestedFrom: new Date(result.fromTime).toISOString(),
        websocketMessages: result.messages,
        candlesReceived: result.candles.length,
        usableCandles: usable.length,
      },
      candles: last,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return Response.json({
      ok: false,
      error: error?.message || String(error),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
};

export const config: Config = { path: "/api/nq-candles-test" };
