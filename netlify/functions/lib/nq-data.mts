import WebSocket from "ws";
import { store } from "./storage.mjs";

export type Bar = { t:number; o:number; h:number; l:number; c:number; v:number };

const BASE = "https://api.tastyworks.com";
const USER_AGENT = "wtc-futes/1.0";
const FLAG_TX_PENDING = 0x01;
const FLAG_REMOVE = 0x02;
const FLAG_SNAPSHOT_BEGIN = 0x04;
const FLAG_SNAPSHOT_END = 0x08;
const FLAG_SNAPSHOT_SNIP = 0x10;

function asNumber(value:unknown):number|null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readJson(res:Response) {
  return res.json().catch(() => ({}));
}

async function getAccessToken() {
  const clientSecret = Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken = Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if (!clientSecret || !refreshToken) throw new Error("Missing tastytrade environment variables");

  const res = await fetch(`${BASE}/oauth/token`, {
    method:"POST",
    headers:{
      "User-Agent":USER_AGENT,
      "Content-Type":"application/json",
      "Accept":"application/json",
    },
    body:JSON.stringify({
      grant_type:"refresh_token",
      refresh_token:refreshToken,
      client_secret:clientSecret,
    }),
  });
  const body:any = await readJson(res);
  if (!res.ok || !body?.access_token) {
    const message = body?.error?.message || body?.message || body?.error?.code || body?.code || "token request failed";
    throw new Error(`tastytrade OAuth ${res.status}: ${message}`);
  }
  return body.access_token as string;
}

async function getActiveNq(accessToken:string) {
  const url = new URL(`${BASE}/instruments/futures`);
  url.searchParams.set("only-active-futures","true");
  url.searchParams.set("per-page","50");
  url.searchParams.append("product-code[]","NQ");

  const res = await fetch(url, {
    headers:{
      "Authorization":`Bearer ${accessToken}`,
      "User-Agent":USER_AGENT,
      "Accept":"application/json",
    },
  });
  const body:any = await readJson(res);
  const items:any[] = body?.data?.items || [];
  if (!res.ok || !items.length) throw new Error(`NQ instrument lookup failed (${res.status})`);

  const tradeable = items.filter((x)=>x?.["is-tradeable"] !== false && x?.active !== false);
  const activeMonth = tradeable.find((x)=>x?.["active-month"] === true);
  const sorted = [...tradeable].sort((a,b)=>{
    const at = Date.parse(a?.["stops-trading-at"] || a?.["expires-at"] || "9999-12-31");
    const bt = Date.parse(b?.["stops-trading-at"] || b?.["expires-at"] || "9999-12-31");
    return at - bt;
  });
  const future = activeMonth || sorted[0] || items[0];
  if (!future?.symbol || !future?.["streamer-symbol"]) throw new Error("Active NQ streamer symbol missing");
  return future;
}

async function getQuoteToken(accessToken:string) {
  const res = await fetch(`${BASE}/api-quote-tokens`, {
    headers:{
      "Authorization":`Bearer ${accessToken}`,
      "User-Agent":USER_AGENT,
      "Accept":"application/json",
    },
  });
  const body:any = await readJson(res);
  const data = body?.data;
  if (!res.ok || !data?.token || !data?.["dxlink-url"]) {
    const message = body?.error?.message || body?.message || body?.error?.code || body?.code || "quote token request failed";
    throw new Error(`tastytrade quote token ${res.status}: ${message}`);
  }
  return data;
}

type Candle = {
  index:number;
  time:number;
  open:number|null;
  high:number|null;
  low:number|null;
  close:number|null;
  volume:number|null;
};
type CandleRow = Candle & { flags:number };

async function fetchHistory(
  dxlinkUrl:string,
  quoteToken:string,
  streamerSymbol:string,
  period:number,
  unit:"m"|"d",
  fromTime:number,
  minEvents:number,
) {
  const candleSymbol = `${streamerSymbol}{=${period}${unit}}`;
  const requestedFields = [
    "eventType","eventSymbol","eventFlags","index","time","count",
    "open","high","low","close","volume","vwap"
  ];

  return await new Promise<{candles:Candle[];snapshotComplete:boolean;candleSymbol:string}>((resolve,reject)=>{
    const ws = new WebSocket(dxlinkUrl);
    const candlesByIndex = new Map<number,Candle>();
    let pending:CandleRow[] = [];
    let inSnapshot = false;
    let snapshotComplete = false;
    let subscribed = false;
    let eventFields:string[] = requestedFields;
    let settled = false;

    const hardTimer = setTimeout(()=>finish(), 12000);

    const cleanup = () => {
      clearTimeout(hardTimer);
      try { ws.close(); } catch {}
    };
    const fail = (err:Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const finish = () => {
      if (settled) return;
      if (!candlesByIndex.size) return fail(new Error(`No ${candleSymbol} history returned before timeout`));
      settled = true;
      cleanup();
      resolve({
        candles:[...candlesByIndex.values()].sort((a,b)=>a.time-b.time),
        snapshotComplete,
        candleSymbol,
      });
    };
    const send = (obj:any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    const applyPending = () => {
      for (const row of pending) {
        if (row.flags & FLAG_REMOVE) candlesByIndex.delete(row.index);
        else candlesByIndex.set(row.index, {
          index:row.index,
          time:row.time,
          open:row.open,
          high:row.high,
          low:row.low,
          close:row.close,
          volume:row.volume,
        });
      }
      pending = [];
    };
    const processCandle = (row:CandleRow) => {
      if (row.flags & FLAG_SNAPSHOT_BEGIN) {
        pending = [];
        inSnapshot = true;
        snapshotComplete = false;
      }
      const endsSnapshot = inSnapshot && Boolean(row.flags & (FLAG_SNAPSHOT_END | FLAG_SNAPSHOT_SNIP));
      if (endsSnapshot) inSnapshot = false;
      pending.push(row);
      if ((row.flags & FLAG_TX_PENDING) || inSnapshot) return;
      if (endsSnapshot) {
        candlesByIndex.clear();
        snapshotComplete = true;
      }
      applyPending();
      if (snapshotComplete && candlesByIndex.size >= minEvents) setTimeout(finish, 120);
    };
    const processCompact = (data:any[]) => {
      if (data.length < 2 || typeof data[0] !== "string" || !Array.isArray(data[1])) return;
      if (data[0] !== "Candle" || !eventFields.length) return;
      const values = data[1];
      for (let cursor=0; cursor + eventFields.length <= values.length; cursor += eventFields.length) {
        const row:Record<string,any> = {eventType:"Candle"};
        for (let i=0;i<eventFields.length;i++) row[eventFields[i]] = values[cursor+i];
        const index = Number(row.index);
        const time = Number(row.time);
        if (!Number.isFinite(index) || !Number.isFinite(time) || time <= 0) continue;
        processCandle({
          index,
          time,
          flags:Number(row.eventFlags) || 0,
          open:asNumber(row.open),
          high:asNumber(row.high),
          low:asNumber(row.low),
          close:asNumber(row.close),
          volume:asNumber(row.volume),
        });
      }
    };

    ws.on("open",()=>send({
      type:"SETUP", channel:0, version:"0.1-DXF-JS/0.3.0",
      keepaliveTimeout:60, acceptKeepaliveTimeout:60,
    }));
    ws.on("error",(err)=>fail(new Error(`DXLink WebSocket error: ${String((err as any)?.message || err)}`)));
    ws.on("message",(raw)=>{
      let msg:any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === "AUTH_STATE" && msg?.state === "UNAUTHORIZED") {
        send({type:"AUTH",channel:0,token:quoteToken});
        return;
      }
      if (msg?.type === "AUTH_STATE" && msg?.state === "AUTHORIZED") {
        send({type:"CHANNEL_REQUEST",channel:3,service:"FEED",parameters:{contract:"HISTORY"}});
        return;
      }
      if (msg?.type === "AUTH_STATE" && msg?.state && msg.state !== "AUTHORIZED" && msg.state !== "UNAUTHORIZED") {
        fail(new Error(`DXLink authorization state: ${msg.state}`));
        return;
      }
      if (msg?.type === "CHANNEL_OPENED" && msg?.channel === 3) {
        send({
          type:"FEED_SETUP",
          channel:3,
          acceptDataFormat:"COMPACT",
          acceptEventFields:{Candle:requestedFields},
        });
        return;
      }
      if (msg?.type === "FEED_CONFIG" && msg?.channel === 3) {
        const negotiated = msg?.eventFields?.Candle;
        if (Array.isArray(negotiated) && negotiated.length) eventFields = negotiated;
        if (!subscribed) {
          subscribed = true;
          send({
            type:"FEED_SUBSCRIPTION",
            channel:3,
            reset:true,
            add:[{type:"Candle",symbol:candleSymbol,fromTime}],
          });
        }
        return;
      }
      if (msg?.type === "FEED_DATA" && msg?.channel === 3 && Array.isArray(msg?.data)) processCompact(msg.data);
    });
  });
}

function toBars(candles:Candle[]):Bar[] {
  const out:Bar[] = [];
  for (const c of candles) {
    if (c.open === null || c.high === null || c.low === null || c.close === null) continue;
    out.push({
      t:Math.floor(c.time/1000),
      o:c.open,
      h:c.high,
      l:c.low,
      c:c.close,
      v:c.volume ?? 0,
    });
  }
  return out.sort((a,b)=>a.t-b.t);
}

// Keep the minute history across the one-minute scheduled executions.
// An overlap is re-fetched each cycle to repair provider gaps and late revisions.
// An interruption longer than 45 minutes forces a full seven-day backfill.
const MINUTE_CACHE_KEY = "nq-minute-bars-v1";
const MINUTE_CACHE_MIN = 1000;
const MINUTE_CACHE_MAX = 8000;
const MINUTE_OVERLAP_MS = 30 * 60 * 1000;
const MAX_INCREMENTAL_GAP_MS = 45 * 60 * 1000;

function mergeMinuteBars(previous: Bar[], fresh: Bar[]) {
  const byTime = new Map<number, Bar>();
  for (const b of previous) if (Number.isFinite(b.t)) byTime.set(b.t, b);
  for (const b of fresh) if (Number.isFinite(b.t)) byTime.set(b.t, b);
  return [...byTime.values()].sort((a,b)=>a.t-b.t).slice(-MINUTE_CACHE_MAX);
}

export async function getNqBars() {
  const accessToken = await getAccessToken();
  const [future, quoteAuth] = await Promise.all([
    getActiveNq(accessToken),
    getQuoteToken(accessToken),
  ]);
  const streamerSymbol = future["streamer-symbol"] as string;
  const now = Date.now();
  const cacheStore = store("mnq-market-bars");
  let saved: any = null;
  try {
    saved = await cacheStore.get(MINUTE_CACHE_KEY, { type: "json" });
  } catch (error:any) {
    console.warn("NQ minute cache read failed; performing full history fetch", error?.message || String(error));
  }
  const cachedBars: Bar[] = saved?.symbol === future.symbol && Array.isArray(saved?.bars)
    ? saved.bars.filter((b:any) =>
        Number.isFinite(b?.t) && Number.isFinite(b?.o) &&
        Number.isFinite(b?.h) && Number.isFinite(b?.l) &&
        Number.isFinite(b?.c) && Number.isFinite(b?.v))
    : [];
  const lastCachedTimeMs = (cachedBars.at(-1)?.t || 0) * 1000;
  const useIncremental = cachedBars.length >= MINUTE_CACHE_MIN &&
    lastCachedTimeMs > 0 &&
    now >= lastCachedTimeMs &&
    now - lastCachedTimeMs <= MAX_INCREMENTAL_GAP_MS;
  const fromTime = useIncremental
    ? lastCachedTimeMs - MINUTE_OVERLAP_MS
    : now - 7 * 24 * 60 * 60 * 1000;
  const dailyPromise = fetchHistory(
    quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol, 1, "d",
    now - 210 * 24 * 60 * 60 * 1000, 55,
  ).then((data)=>({ok:true as const,data,error:null as string|null}))
   .catch((error:any)=>({ok:false as const,data:null,error:error?.message||String(error)}));

  let minute = await fetchHistory(
    quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol, 1, "m",
    fromTime, useIncremental ? 1 : MINUTE_CACHE_MIN,
  );
  let incoming = toBars(minute.candles);
  if (!minute.snapshotComplete || !incoming.length) {
    throw new Error("NQ 1m snapshot incomplete or empty");
  }
  let minuteBars = useIncremental ? mergeMinuteBars(cachedBars, incoming) : incoming.slice(-MINUTE_CACHE_MAX);

  // If cache cannot provide the required lookback, rebuild from provider history.
  if (minuteBars.length < MINUTE_CACHE_MIN) {
    minute = await fetchHistory(
      quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol, 1, "m",
      now - 7 * 24 * 60 * 60 * 1000, MINUTE_CACHE_MIN,
    );
    incoming = toBars(minute.candles);
    if (!minute.snapshotComplete) throw new Error("NQ 1m full backfill incomplete");
    minuteBars = incoming.slice(-MINUTE_CACHE_MAX);
  }
  if (minuteBars.length < MINUTE_CACHE_MIN) {
    throw new Error(`NQ 1m history incomplete (${minuteBars.length} bars)`);
  }

  // A completed HISTORY snapshot can still end with an old candle. In that
  // case, open one new DXLink session and request a recent overlap before
  // reporting the feed paused. The independent REST quote never invents bars.
  let recoveryAttempted = false;
  if (now - (minuteBars.at(-1)?.t || 0) * 1000 > 90_000) {
    recoveryAttempted = true;
    try {
      const recovery = await fetchHistory(
        quoteAuth["dxlink-url"], quoteAuth.token, streamerSymbol, 1, "m",
        now - 60 * 60 * 1000, 1,
      );
      if (recovery.snapshotComplete && recovery.candles.length) {
        minuteBars = mergeMinuteBars(minuteBars, toBars(recovery.candles));
      }
    } catch (error:any) {
      console.warn("NQ DXLink recovery attempt failed", error?.message || String(error));
    }
  }

  // Only cache a successfully completed provider snapshot. Never synthesize
  // candles or promote a cached timestamp to make the feed appear live.
  try {
    await cacheStore.setJSON(MINUTE_CACHE_KEY, {
      symbol: future.symbol, bars: minuteBars, cachedAt: new Date().toISOString(),
    });
  } catch (error:any) {
    console.warn("NQ minute cache write failed; fresh bars remain usable", error?.message || String(error));
  }

  const dailyResult = await dailyPromise;
  let dailyBars: Bar[] = [];
  let dailyError: string | null = dailyResult.error;
  if (dailyResult.ok && dailyResult.data) {
    dailyBars = toBars(dailyResult.data.candles);
    if (!dailyResult.data.snapshotComplete || dailyBars.length < 30) {
      dailyError = `NQ daily history incomplete (${dailyBars.length} bars)`;
      dailyBars = [];
    }
  }

  return {
    symbol: future.symbol as string,
    streamerSymbol,
    exchange: future.exchange || "CME",
    expirationDate: future["expiration-date"] || null,
    minuteBars,
    dailyBars,
    dailyHealth: { ok: dailyBars.length >= 30, error: dailyError },
    source: "tastytrade DXLink / CME",
    minuteHistorySource: useIncremental ? "cached+DXLink-overlap" : "DXLink-full-backfill",
    recoveryAttempted,
  };
}
