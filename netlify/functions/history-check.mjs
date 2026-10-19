/**
 * Public, rate-limited diagnostics only. Probes the user's tastytrade DXLink
 * entitlement for a completed historical QQQ Candle snapshot.
 * Never sends access tokens, quote tokens, or raw licensed market data to clients.
 * A successful quote entitlement is NOT evidence of historical coverage.
 */
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
const env = name => globalThis.Netlify?.env?.get(name) ?? process.env[name];

async function requestQuoteCredentials() {
  const clientSecret = env("TASTY_CLIENT_SECRET");
  const refreshToken = env("TASTY_REFRESH_TOKEN");
  if (!clientSecret || !refreshToken) throw new Error("credentials_not_configured");
  const auth = await fetch("https://api.tastyworks.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": "strategy-signals/1.0" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_secret: clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  if (!auth.ok) throw new Error("oauth_failed");
  const token = (await auth.json()).access_token;
  if (typeof token !== "string" || !token) throw new Error("oauth_invalid_response");
  const quote = await fetch("https://api.tastyworks.com/api-quote-tokens", {
    headers: { authorization: "Bearer " + token, "user-agent": "strategy-signals/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!quote.ok) throw new Error("quote_entitlement_failed");
  const response = (await quote.json()).data;
  if (!response?.token || !response?.["dxlink-url"]) throw new Error("quote_invalid_response");
  const url = new URL(response["dxlink-url"]);
  if (url.protocol !== "wss:" || !(url.hostname === "dxfeed.com" || url.hostname.endsWith(".dxfeed.com")))
    throw new Error("unexpected_dxlink_host");
  return { url: url.toString(), quoteToken: response.token };
}

function extractRows(message) {
  const data = message.data;
  if (!Array.isArray(data)) return [];
  // dxLink COMPACT can represent a frame as ["Candle", [row], [row], ...].
  if (data[0] === "Candle") return data.slice(1).filter(Array.isArray);
  // Accept alternate event-array framing, without assuming field order.
  if (data.every(x => Array.isArray(x))) return data.flatMap(x =>
    x[0] === "Candle" && Array.isArray(x[1]) ? x.slice(1).filter(Array.isArray) : []
  );
  return [];
}

function readSnapshot(url, quoteToken, fromTime) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fields = ["eventSymbol","eventFlags","time","open","high","low","close","volume"];
    const readings = new Map();
    let count = 0, snapshotComplete = false, snapshotSnipped = false, started = false, invalid = 0, diagnostic = null, finished = false;
    let feedFrames = 0, candleFrames = 0, aggregationPeriod = null, firstReceivedTime = null, lastReceivedTime = null;
    const flagCounts = { begin:0, end:0, snip:0, remove:0, txPending:0 };
    const timer = setTimeout(() => finish(false, "snapshot_timeout"), 35000);
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KEEPALIVE", channel: 0 }));
    }, 15000);
    function finish(ok, reason) {
      if (finished) return;
      finished = true; clearTimeout(timer); clearInterval(keepalive);
      try { ws.close(1000, "probe complete"); } catch {}
      const ordered = [...readings.values()].sort((a,b) => a.time - b.time);
      const first = ordered[0], last = ordered.at(-1);
      const candlesByYear = {}, candlesByMonth2026 = {};
      for (const candle of ordered) {
        const date = new Date(candle.time).toISOString().slice(0,10), year = date.slice(0,4);
        candlesByYear[year] = (candlesByYear[year] ?? 0) + 1;
        if (year === "2026") candlesByMonth2026[date.slice(0,7)] = (candlesByMonth2026[date.slice(0,7)] ?? 0) + 1;
      }
      resolve({
        snapshotComplete,
        snapshotStarted: started,
        snapshotSnipped,
        feedFrames,
        candleFrames,
        aggregationPeriod,
        flags: flagCounts,
        candlesByYear,
        candlesByMonth2026,
        firstReceivedUTC: firstReceivedTime ? new Date(firstReceivedTime).toISOString().slice(0,10) : null,
        lastReceivedUTC: lastReceivedTime ? new Date(lastReceivedTime).toISOString().slice(0,10) : null,
        records: count,
        distinctCandles: ordered.length,
        malformedCandles: invalid,
        earliestUTC: first ? new Date(first.time).toISOString().slice(0,10) : null,
        latestUTC: last ? new Date(last.time).toISOString().slice(0,10) : null,
        historyFromRequestedUTC: new Date(fromTime).toISOString().slice(0,10),
        coverageFrom2020: !!first && first.time <= Date.parse("2020-02-01T00:00:00Z"),
        sufficientForEma270: ordered.length >= 270,
        status: reason ?? (ok ? "snapshot_complete" : "snapshot_incomplete"),
      });
    }
    const send = msg => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
    ws.addEventListener("open", () => send({
      type: "SETUP", channel: 0, version: "0.1-DXF-JS/0.3.0",
      keepaliveTimeout: 60, acceptKeepaliveTimeout: 60,
    }));
    ws.addEventListener("message", event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "AUTH_STATE") {
        if (msg.state === "UNAUTHORIZED")
          send({ type:"AUTH", channel:0, token:quoteToken });
        else if (msg.state === "AUTHORIZED")
          send({ type:"CHANNEL_REQUEST", channel:3, service:"FEED", parameters:{ contract:"AUTO" } });
        else if (msg.state === "NOT_AUTHORIZED" || msg.state === "AUTH_FAILED")
          finish(false, "dxlink_auth_denied");
      } else if (msg.type === "CHANNEL_OPENED" && msg.channel === 3) {
        send({
          type: "FEED_SETUP", channel:3, acceptAggregationPeriod:0.1, acceptDataFormat:"COMPACT",
          acceptEventFields: { Candle: fields },
        });
      } else if (msg.type === "FEED_CONFIG" && msg.channel === 3) {
        aggregationPeriod = Number(msg.aggregationPeriod) || null;
        send({
          type: "FEED_SUBSCRIPTION", channel:3, reset:true,
          add: [{ type:"Candle", symbol:"QQQ{=d}", fromTime }],
        });
      } else if (msg.type === "FEED_DATA" && msg.channel === 3) {
        feedFrames++;
        const rows = extractRows(msg); if (rows.length) candleFrames++;
        for (const row of rows) {
          const flags = Number(row[1]) || 0;
          const rawTime = Number(row[2]);
          const time = rawTime < 1e11 ? rawTime * 1000 : rawTime;
          const close = Number(row[6]);
          count++;
          if (flags & 4) { started = true; flagCounts.begin++; }
          if (flags & 8) flagCounts.end++;
          if (flags & 16) flagCounts.snip++;
          if (flags & 2) flagCounts.remove++;
          if (flags & 1) flagCounts.txPending++;
          if (Number.isFinite(time) && time >= Date.parse("1995-01-01T00:00:00Z") &&
              time < Date.now() + 86400000 && Number.isFinite(close) && close > 0) {
            readings.set(time, {time, close});
            if (firstReceivedTime === null) firstReceivedTime = time;
            lastReceivedTime = time;
          } else invalid++;
          if (flags & 8) snapshotComplete = true;
          if (flags & 16) snapshotSnipped = true;
        }
        if (snapshotComplete || snapshotSnipped) finish(snapshotComplete && !snapshotSnipped, snapshotSnipped ? "snapshot_snipped" : undefined);
      } else if (msg.type === "ERROR" || msg.type === "CHANNEL_CLOSED") {
        diagnostic = "dxlink_feed_error";
        finish(false, diagnostic);
      }
    });
    ws.addEventListener("error", () => finish(false, "dxlink_socket_error"));
    ws.addEventListener("close", () => finish(false, "dxlink_socket_closed_before_snapshot"));
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return respond({ status:"method_not_allowed" },405);
  try {
    // Public diagnostic is intentionally restricted to one hard-coded symbol and interval.
    // No user-controlled paths, URLs, symbols, provider requests or data are accepted.
    const credentials = await requestQuoteCredentials();
    const requestedWindow = new URL(request.url).searchParams.get("window") ?? "2020";
    if (!["2020","2025","2026"].includes(requestedWindow)) return respond({status:"invalid_window"},400);
    const fromTime = Date.parse(requestedWindow + "-01-02T00:00:00Z");
    const result = await readSnapshot(credentials.url, credentials.quoteToken, fromTime);
    return respond({
      provider:"Tastytrade / DXLink", symbol:"QQQ", interval:"1d", readOnly:true,
      ...result,
      requestedWindow,
      verified:requestedWindow === "2020" && result.snapshotComplete && !result.snapshotSnipped && result.coverageFrom2020 && result.sufficientForEma270 && result.malformedCandles === 0,
      disclaimer:"Coverage diagnostics only. Shorter windows are comparison tests, not valid 2020-seeded EMAs. No live signals are calculated here.",
    });
  } catch (error) {
    const known = new Set([
      "credentials_not_configured","oauth_failed","oauth_invalid_response","quote_entitlement_failed",
      "quote_invalid_response","unexpected_dxlink_host"
    ]);
    return respond({status:known.has(error?.message)?error.message:"provider_temporarily_unavailable",verified:false},503);
  }
}

export const config = {
  path: ["/api/history-check", "/.netlify/functions/history-check"],
  rateLimit: { action:"rate_limit", aggregateBy:["ip","domain"], windowSize:300, windowLimit:2 },
};
