// Public, read-only diagnostic: test complete third-party daily historical data
// without exposing user's tastytrade secrets, accounts, or raw bulk candles.
// These sources are candidates, not authorized signal sources until price
// adjustments, market session times, and adjusted-factor methodology pass review.
const json = (data, status=200) => new Response(JSON.stringify(data), {
 status, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const from = Math.floor(Date.parse('2020-01-01T00:00:00Z')/1000);
const to = Math.floor(Date.now()/1000)+86400;
const lastNeeded = '2026-10-16';
const validStart = '2020-01-15';
const dateString = n => new Date(n*1000).toISOString().slice(0,10);
const classifyError = e => ({ready:false, reason:e?.name==='TimeoutError'?'provider_timeout':'provider_unavailable'});

async function yahoo(symbol) {
 const encoded=encodeURIComponent(symbol);
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encoded+'?period1='+from+'&period2='+to+'&interval=1d&events=div%2Csplits';
 const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 StrategySignals/1.0','accept':'application/json'},signal:AbortSignal.timeout(5500)});
 if(!r.ok)return {ready:false,httpStatus:r.status,reason:'provider_http_error'};
 const obj=await r.json();
 const result=obj?.chart?.result?.[0];
 if(!result?.timestamp?.length || !result?.indicators?.quote?.[0]?.close)
   return {ready:false,reason:'invalid_chart_payload'};
 const close=result.indicators.quote[0].close,adj=result.indicators.adjclose?.[0]?.adjclose??[];
 const byDate=new Map();
 for(let i=0;i<result.timestamp.length;i++) {
  const d=dateString(result.timestamp[i]),price=close[i];
  if(Number.isFinite(price)&&price>0)byDate.set(d,{price,adjustedClose:adj[i]??null});
 }
 const keys=[...byDate.keys()].sort();
 const earliest=keys[0]??null,latest=keys.at(-1)??null;
 const count2026=keys.filter(k=>k.startsWith('2026')).length;
 const starts2020=earliest!==null && earliest<=validStart;
 const thruRecent=latest!==null && latest>=lastNeeded;
 return {ready:starts2020&&thruRecent&&keys.length>=1450&&count2026>=170&&keys.length>=result.timestamp.length*.98,
  observations:keys.length,chartRecords:result.timestamp.length,earliest,latest,count2026,
  hasAdjustedClose:adj.length>0,contains2020:starts2020,coversLastFriday:thruRecent,
  closeForLatest:keys.length?Number(byDate.get(latest).price.toFixed(4)):null,
  splitEvents:Object.keys(result.events?.splits??{}).length,
  note:'Candidate: Yahoo chart closes, independent adjustment and gap checks still required'};
}
async function stooq(){
 const end=new Date(to*1000).toISOString().slice(0,10).replaceAll('-','');
 const u='https://stooq.com/q/d/l/?s=qqq.us&i=d&d1=20200101&d2='+end;
 const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0','accept':'text/csv,text/plain'},signal:AbortSignal.timeout(5500)});
 if(!r.ok)return {ready:false,httpStatus:r.status,reason:'provider_http_error'};
 const data=await r.text();if(data.length>1_000_000)return {ready:false,reason:'response_too_large'};
 const lines=data.trim().split(/\r?\n/);
 if(!lines[0]?.toLowerCase().startsWith('date,'))return {ready:false,reason:'invalid_csv_header'};
 const dates=[];
 for(const line of lines.slice(1)){
  const a=line.split(',');
  if(/^\d{4}-\d\d-\d\d$/.test(a[0])&&Number.isFinite(Number(a[4]))&&Number(a[4])>0)dates.push(a[0]);
 }
 const keys=[...new Set(dates)].sort(),earliest=keys[0]??null,latest=keys.at(-1)??null;
 return {ready:keys.length>=1450&&earliest<=validStart&&latest>=lastNeeded&&keys.length===dates.length,
  observations:keys.length,earliest,latest,count2026:keys.filter(k=>k.startsWith('2026')).length,
  note:'Candidate: CSV may be dividend-adjusted; not cleared for King thresholds'};
}
export default async function handler(req){
 if(req.method!=='GET')return json({status:'method_not_allowed'},405);
 const jobs=[['yahooQQQ',()=>yahoo('QQQ')],['yahooVIX3M',()=>yahoo('^VIX3M')],['stooqQQQ',stooq]];
 const results=await Promise.all(jobs.map(async ([name,fn])=>{
  try{return [name,await fn()]}catch(e){return [name,classifyError(e)]}
 }));
 return json({status:'completed',sourceDiagnostics:Object.fromEntries(results),readOnly:true,
  signalsVerified:false,notes:'Candidate data-source reachability and coverage only. No trading signals are published or credentials exposed.'});
}
export const config = {path:['/api/history-sources','/.netlify/functions/history-sources'],
 rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowSize:300,windowLimit:3}};
