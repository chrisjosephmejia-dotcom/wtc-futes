import WebSocket from "ws";

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-futes/1.0";
const FLAG_TX_PENDING = 0x01;
const FLAG_SNAPSHOT_END = 0x08;
const FLAG_SNAPSHOT_SNIP = 0x10;

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
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
  if (!res.ok || !body?.access_token) throw new Error(`tastytrade OAuth ${res.status}`);
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
  if (!res.ok || !data?.token || !data?.["dxlink-url"]) throw new Error(`tastytrade quote token ${res.status}`);
  return data;
}

type Latest = { time: number; close: number };

async function fetchLatestMinute(dxlinkUrl: string, quoteToken: string, streamerSymbol: string) {
  const candleSymbol = `${streamerSymbol}{=1m}`;
  const requestedFields = [
    "eventType", "eventSymbol", "eventFlags", "index", "time", "count",
    "open", "high", "low", "close", "volume", "vwap",
  ];

  return await new Promise<Latest>((resolve, reject) => {
    const ws = new WebSocket(dxlinkUrl);
    let eventFields: string[] = requestedFields;
    let latest: Latest | null = null;
    let settled = false;
    let subscribed = false;
    const hardTimer = setTimeout(() => finish(), 8000);

    const cleanup = () => {
      clearTimeout(hardTimer);
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
      if (!latest) return fail(new Error("No live NQ minute candle returned"));
      settled = true;
      cleanup();
      resolve(latest);
    };
    const send = (obj: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    const processCompact = (data: any[]) => {
      if (data.length < 2 || data[0] !== "Candle" || !Array.isArray(data[1])) return;
      const values = data[1];
      let snapshotEnded = false;
      for (let cursor = 0; cursor + eventFields.length <= values.length; cursor += eventFields.length) {
        const row: Record<string, any> = {};
        for (let i = 0; i < eventFields.length; i++) row[eventFields[i]] = values[cursor + i];
        const time = Number(row.time);
        const close = Number(row.close);
        const flags = Number(row.eventFlags) || 0;
        if (Number.isFinite(time) && Number.isFinite(close) && time > 0) {
          if (!latest || time >= latest.time) latest = { time, close };
        }
        if (!(flags & FLAG_TX_PENDING) && (flags & (FLAG_SNAPSHOT_END | FLAG_SNAPSHOT_SNIP))) snapshotEnded = true;
      }
      if (snapshotEnded && latest) setTimeout(finish, 50);
    };

    ws.on("open", () => send({
      type: "SETUP", channel: 0, version: "0.1-DXF-JS/0.3.0",
      keepaliveTimeout: 60, acceptKeepaliveTimeout: 60,
    }));
    ws.on("error", (err) => fail(new Error(`DXLink WebSocket error: ${String((err as any)?.message || err)}`)));
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === "AUTH_STATE" && msg?.state === "UNAUTHORIZED") {
        send({ type: "AUTH", channel: 0, token: quoteToken });
        return;
      }
      if (msg?.type === "AUTH_STATE" && msg?.state === "AUTHORIZED") {
        send({ type: "CHANNEL_REQUEST", channel: 3, service: "FEED", parameters: { contract: "HISTORY" } });
        return;
      }
      if (msg?.type === "CHANNEL_OPENED" && msg?.channel === 3) {
        send({
          type: "FEED_SETUP",
          channel: 3,
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
            add: [{ type: "Candle", symbol: candleSymbol, fromTime: Date.now() - 15 * 60 * 1000 }],
          });
        }
        return;
      }
      if (msg?.type === "FEED_DATA" && msg?.channel === 3 && Array.isArray(msg?.data)) processCompact(msg.data);
    });
  });
}

export async function getLiveNqPrice() {
  const accessToken = await getAccessToken();
  const [future, quoteAuth] = await Promise.all([
    getActiveNq(accessToken),
    getQuoteToken(accessToken),
  ]);
  const streamerSymbol = future["streamer-symbol"] as string;
  const latest = await fetchLatestMinute(quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol);
  return {
    symbol: future.symbol as string,
    streamerSymbol,
    exchange: future.exchange || "CME",
    expirationDate: future["expiration-date"] || null,
    price: latest.close,
    barTime: new Date(latest.time).toISOString(),
    source: "tastytrade DXLink / CME",
  };
}
