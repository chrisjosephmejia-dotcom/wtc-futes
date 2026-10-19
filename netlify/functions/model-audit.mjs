// Historical factor validation for public read-only Strategy Signals.
// Never issues orders, never exposes secrets or full vendor time-series to browsers.
// This is a provisional diagnostic, NOT a confirmed signal source.
import { ema, kingWeekly, hybrid, centurionDaily } from "../../lib/engine.mjs";

const symbols=["QQQ","HYG","LQD","QQEW","XLU","SPY","^VIX","^VIX3M"];
const codeOf=s=>s.replace("^","");
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const round=(n,p=4)=>Number(n?.toFixed(p));
const epoch=Date.parse("2020-01-01T00:00:00Z")/1000;
const utcDate=s=>new Date(s*1000).toISOString().slice(0,10);
function lastCompletedUSSession(){
 const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const p=Object.fromEntries(fmt.formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
 const today=p.year+"-"+p.month+"-"+p.day;
 const day=new Date(today+"T00:00:00Z").getUTCDay(),after=Number(p.hour)*60+Number(p.minute)>=16*60+15;
 const offset=day===0?2:day===6?1:!after?day===1?3:1:0;
 const d=new Date(today+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-offset);
 return d.toISOString().slice(0,10);
}
async function chart(symbol){
 const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?period1="+epoch+"&period2="+(Math.floor(Date.now()/1000)+86400)+"&interval=1d&events=div%2Csplits";
 const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 StrategySignals/1.0","accept":"application/json"},signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw Error("http_"+r.status);
 const data=(await r.json())?.chart?.result?.[0];
 if(!Array.isArray(data?.timestamp)||!Array.isArray(data?.indicators?.quote?.[0]?.close))throw Error("invalid_data");
 const raw=data.indicators.quote[0].close,adjusted=data.indicators.adjclose?.[0]?.adjclose;
 const m=new Map();let invalid=0;
 for(let i=0;i<data.timestamp.length;i++){
  const date=utcDate(data.timestamp[i]),price=raw[i],adj=adjusted?.[i];
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(adj)||adj<=0){invalid++;continue}
  m.set(date,{raw:price,adj});
 }
 const dates=[...m.keys()].sort();
 const last=dates.at(-1),first=dates[0];
 return {symbol,count:dates.length,missingOrBad:invalid,start:first,end:last,lastRaw:m.get(last)?.raw,lastAdj:m.get(last)?.adj,
  splitEvents:Object.keys(data.events?.splits??{}).length,series:m};
}
function weeklyCloses(qqq){
 const weeks=new Map();
 for(const [date,p] of qqq.series){
  if(date<"2026-08-07")continue;
  const d=new Date(date+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  const monday=d.toISOString().slice(0,10);
  const last=weeks.get(monday);
  if(!last||last.date<date)weeks.set(monday,{date,close:p.raw});
 }
 return [...weeks.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function rollingEma(arr,p){
 let x=null;const a=2/(p+1),out=[];
 for(let i=0;i<arr.length;i++){
  if(i<p-1){out.push(null);continue}
  if(i===p-1)x=arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
  else x+=a*(arr[i]-x);
  out.push(x);
 }
 return out;
}
function diagnostics(series,lastCompleted){
 const q=series.QQQ;
 if(!q||q.count<1400||q.start>"2020-01-15"||q.end<lastCompleted)throw Error("incomplete_qqq_history");
 const closeDates=[...q.series.keys()].sort().filter(d=>d<=lastCompleted);
 const adj=s=>closeDates.map(d=>series[s]?.series.get(d)?.adj??null);
 const gaps={};
 for(const s of symbols){
  const sym=series[s];if(!sym){gaps[s]="missing_source";continue}
  const last120=closeDates.slice(-120),missed=last120.filter(d=>!sym.series.has(d)).length;
  gaps[s]={count:sym.count,start:sym.start,end:sym.end,last120Missing:missed,invalid:sym.missingOrBad};
 }
 const week=weeklyCloses(q).filter(x=>x.date<=lastCompleted);
 const king=kingWeekly(week,{mode:"BULLISH",bullHigh:723.03,startDate:"2026-08-07"});
 const raw=closeDates.map(d=>q.series.get(d).raw);
 const h=hybrid(raw,king.mode);
 const hybridReport={
  status:h.verified&&gaps.QQQ.last120Missing===0?"candidate_complete":"unverified",
  asOf:closeDates.at(-1),qqqClose:round(raw.at(-1),2),
  ema80:h.ema80,ema270:h.ema270,emaRegime:h.emaRegime,
  kingRegime:king.mode,kingCurrentBullHigh:round(king.bullHigh,2),kingCurrentBearLow:round(king.bearLow??0,2),
  kingWeeklyObservations:week.length,lastFourWeeklyCloses:week.slice(-4).map(x=>({date:x.date,close:round(x.close,2)})),
  kingSwitches:king.switches,provisionalTarget:h.target
 };
 let centurionReport={status:"unverified",reason:"missing_factors"};
 const factorsReady=symbols.every(s=>series[s]?.count>=1300&&gaps[s]?.last120Missing===0&&series[s].end>=lastCompleted);
 if(factorsReady){
  const qadj=adj("QQQ");
  const hyg=adj("HYG"),lqd=adj("LQD"),qqew=adj("QQEW"),xlu=adj("XLU"),spy=adj("SPY"),vix=adj("^VIX"),vix3m=adj("^VIX3M");
  const ratio=(a,b)=>a.map((x,i)=>x===null||b[i]===null?null:x/b[i]);
  const credit=ratio(hyg,lqd),breadth=ratio(qqew,qadj),utilities=ratio(xlu,spy);
  const breadthEma=rollingEma(breadth,100),trendEma=rollingEma(qadj,150),utilsEma=rollingEma(utilities,50);
  const daily=[];let skipped=0;
  for(let i=150;i<closeDates.length;i++){
   const arr=[credit[i],credit[i-20],breadth[i],breadthEma[i],qadj[i],trendEma[i],utilities[i],utilsEma[i],vix[i],vix3m[i]];
   if(arr.some(x=>!Number.isFinite(x))){skipped++;continue}
   daily.push({date:closeDates[i],
    credit:credit[i]/credit[i-20]-1>0,
    volatility:vix[i]<vix3m[i],
    breadth:breadth[i]>breadthEma[i],
    trend:qadj[i]>trendEma[i],
    utilities:utilities[i]<utilsEma[i]
   });
  }
  const replay=centurionDaily(daily);
  const latest=replay.at(-1),factor=daily.at(-1);
  const entryEvents=replay.filter((r,i)=>i>0&&r.mode==="ON"&&replay[i-1].mode==="OFF");
  const exitEvents=replay.filter((r,i)=>i>0&&r.mode==="OFF"&&replay[i-1].mode==="ON");
  const sepIndex=replay.findIndex(r=>r.date==="2026-09-01"),sep=replay[sepIndex]??null,sepFactors=daily[sepIndex]??null;
  const previousEntry=entryEvents.filter(e=>e.date<=latest.date).at(-1)?.date??null;
  centurionReport={
   status:skipped===0?"candidate_complete":"gaps_during_replay",
   asOf:latest?.date??null, observedSessions:daily.length,skippedSessions:skipped,
   factors:factor,rawScore:latest?.rawScore,smoothedScore:latest?.smoothedScore,
   provisionalRegime:latest?.mode,provisionalTarget:latest?.target,lastRiskOnEntry:previousEntry,
   lastRiskOffExit:exitEvents.at(-1)?.date??null,
   sep1ManualCheck:sep?{date:sep.date,rawScore:sep.rawScore,smoothedScore:sep.smoothedScore,mode:sep.mode,factors:sepFactors,manualExpected:{riskOnSince:"2026-04-17",allFiveChecksPass:true,rawScore:1,smoothedScoreApprox:0.815}}:null,
   caution:"Current factor replay uses January-2020 seeded history and Yahoo adjusted closes. Verify against frozen model and official 2026-09-01 checkpoint before activating."
  };
 }
 return {asOf:closeDates.at(-1),lastCompletedSession:lastCompleted,readyForLiveSignals:false,
  observationCount:closeDates.length,sources:gaps,
  hybrid:hybridReport,centurion:centurionReport,
  note:"Research diagnostic only; candidate values are not verified published recommendations."};
}
export default async function handler(req){
 if(req.method!=="GET")return respond({status:"method_not_allowed"},405);
 const fetched=await Promise.all(symbols.map(async symbol=>{
  try{return {symbol,value:await chart(symbol)}}catch(e){return {symbol,error:String(e?.message??"request_failed").slice(0,60)}}
 }));
 const errors=fetched.filter(x=>x.error);
 const summaries=Object.fromEntries(fetched.filter(x=>x.value).map(x=>[x.symbol,x.value]));
 const lastSession=lastCompletedUSSession();
 if(errors.length)return respond({status:"source_fetch_incomplete",lastCompletedSession:lastSession,
  errors,received:Object.fromEntries(Object.entries(summaries).map(([k,s])=>[k,{count:s.count,start:s.start,end:s.end}]))});
 try {return respond({status:"research_ready",...diagnostics(summaries,lastSession)})}
 catch(e){return respond({status:"source_validation_failed",lastCompletedSession:lastSession,reason:e?.message??"diagnostics_failed",
   sourceSummaries:Object.fromEntries(Object.entries(summaries).map(([k,s])=>[k,{count:s.count,start:s.start,end:s.end}]))})}
}
export const config={path:["/api/model-audit","/.netlify/functions/model-audit"],
 rateLimit:{action:"rate_limit",aggregateBy:["ip","domain"],windowSize:300,windowLimit:3}};
