import test from "node:test";
import assert from "node:assert/strict";
import { validateQuote, getLiveNqPrice } from "../netlify/functions/lib/live-nq.mts";
import { nqCandleSymbol } from "../netlify/functions/lib/nq-candle-symbol.mts";
import { resolvePositionState } from "../netlify/functions/lib/position-state.mts";

const NOW = Date.parse("2026-11-11T23:38:00.000Z");
const quote = (timestamp, extra={}) => ({ last: "28163.25", "updated-at": timestamp, ...extra });

test("recent REST NQ quote is accepted with source timestamp", () => {
  const result = validateQuote(quote(new Date(NOW-15_000).toISOString()), NOW);
  assert.equal(result.price, 28163.25);
  assert.equal(result.ageSec, 15);
});
test("REST quote rejects stale, invalid, missing, or future data", () => {
  assert.throws(() => validateQuote(quote(new Date(NOW-121_000).toISOString()), NOW), /stale/);
  assert.throws(() => validateQuote({ last: 28163.25 }, NOW), /timestamp/);
  assert.throws(() => validateQuote(quote(new Date(NOW).toISOString(), {last: "NaN"}), NOW), /price/);
  assert.throws(() => validateQuote(quote(new Date(NOW+31_000).toISOString()), NOW), /future/);
});
test("REST quote uses mark if last is absent and accepts camel-case update time", () => {
  const result = validateQuote({mark: "28164", updatedAt: new Date(NOW).toISOString()}, NOW);
  assert.equal(result.price, 28164);
});

test("live quote endpoint is independent of the DXLink candle socket", async () => {
  const oldFetch=globalThis.fetch;
  const oldNetlify=globalThis.Netlify;
  const called=[];
  globalThis.Netlify={env:{get:(k)=>({TASTY_CLIENT_SECRET:"test",TASTY_REFRESH_TOKEN:"test"})[k]}};
  globalThis.fetch=async (url,options)=>{
    const u=new URL(String(url));called.push(u.pathname);
    const body=u.pathname==="/oauth/token"
      ? {access_token:"fake-access"}
      : u.pathname==="/instruments/futures"
        ? {data:{items:[{symbol:"/NQZ6","active-month":true,"streamer-symbol":"/NQZ26:XCME"}]}}
        : {data:{items:[{symbol:"/NQZ6",last:"28163.25","updated-at":new Date().toISOString()}]}};
    return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
  };
  try {
    const result=await getLiveNqPrice();
    assert.equal(result.price,28163.25);
    assert.equal(result.verified,true);
    assert.deepEqual(called,["/oauth/token","/instruments/futures","/market-data/by-type"]);
  } finally {globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;}
});

test("stale DXLink bars preserve held short without a false risk assessment", () => {
  const raw={
    signal:"WAIT", reason:"FEED PAUSED", score:-5, price:28163,
    market:{session:true,feedActive:false,lastBarOhlc:{high:28270,low:28090}},
  };
  const position=resolvePositionState(raw,"SELL MNQ",{status:"OPEN",direction:"SELL MNQ",entryPrice:28150});
  assert.equal(position.signal,"SELL MNQ");
  assert.equal(position.positionEvent,"HOLD");
  assert.equal(position.riskCap.shadowRisk,null);
});
test("stale DXLink bars cannot generate new entries", () => {
  const raw={signal:"WAIT",reason:"FEED PAUSED",score:-5,market:{session:true,feedActive:false}};
  const position=resolvePositionState(raw,"WAIT");
  assert.equal(position.signal,"WAIT");
  assert.equal(position.positionEvent,"FLAT");
});


test("intraday NQ candles explicitly aggregate all valid trades, including ETH", () => {
  assert.equal(nqCandleSymbol("/NQZ26:XCME", 1, "m"), "/NQZ26:XCME{=1m,dt=all}");
  assert.equal(nqCandleSymbol("/NQZ26:XCME", 5, "m"), "/NQZ26:XCME{=5m,dt=all}");
  assert.equal(nqCandleSymbol("/NQZ26:XCME", 1, "d"), "/NQZ26:XCME{=1d}");
  assert.throws(() => nqCandleSymbol("",1,"m"), /Invalid/);
});
