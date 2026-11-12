import test from "node:test";
import assert from "node:assert/strict";
import { validateQuote, getLiveMclPrice } from "../netlify/functions/lib/live-mcl.mts";

const NOW=Date.parse("2026-11-12T03:12:00.000Z");
test("MCL REST price accepts fresh quote with source timestamp",()=>{
  const actual=validateQuote({last:"84.63","updated-at":new Date(NOW-18000).toISOString()},NOW);
  assert.equal(actual.price,84.63);
  assert.equal(actual.ageSec,18);
});
test("MCL quote cannot silently display stale or malformed prices",()=>{
  assert.throws(()=>validateQuote({last:"84.63","updated-at":new Date(NOW-121000).toISOString()},NOW),/stale/);
  assert.throws(()=>validateQuote({last:"84.63"},NOW),/timestamp/);
  assert.throws(()=>validateQuote({last:"0","updated-at":new Date(NOW).toISOString()},NOW),/price/);
  assert.throws(()=>validateQuote({last:84.63,"updated-at":new Date(NOW+31000).toISOString()},NOW),/future/);
});
test("MCL read-only display calls REST and never opens a DXLink socket",async()=>{
  const previousFetch=globalThis.fetch,previousNetlify=globalThis.Netlify;
  const urls=[];
  globalThis.Netlify={env:{get:k=>({TASTY_CLIENT_SECRET:"fixture",TASTY_REFRESH_TOKEN:"fixture"})[k]}};
  globalThis.fetch=async (url,options)=>{
    const path=new URL(String(url)).pathname;urls.push(path);
    let response;
    if(path==="/oauth/token")response={access_token:"mock"};
    else if(path==="/instruments/futures")response={data:{items:[{symbol:"/MCLF7","active-month":true,"streamer-symbol":"/CLF27:XCME"}]}};
    else response={data:{items:[{symbol:"/MCLF7",last:"84.64","updated-at":new Date().toISOString()}]}};
    return new Response(JSON.stringify(response),{status:200,headers:{"content-type":"application/json"}});
  };
  try {
    const quote=await getLiveMclPrice();
    assert.equal(quote.price,84.64);
    assert.equal(quote.verified,true);
    assert.deepEqual(urls,["/oauth/token","/instruments/futures","/market-data/by-type"]);
  }finally{globalThis.fetch=previousFetch;globalThis.Netlify=previousNetlify}
});
