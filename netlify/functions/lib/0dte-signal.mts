import type { Bar } from "./equity-data.mts";
import type { Quote } from "./tasty-0dte.mts";

export type Direction="CALL"|"PUT";
export type SignalFactor={name:string;points:number;detail:string};

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;

function emaSeries(xs:number[],n:number){
  if(!xs.length)return[];const k=2/(n+1),out=[xs[0]];
  for(let i=1;i<xs.length;i++)out.push(xs[i]*k+out[i-1]*(1-k));
  return out;
}
function rsi(xs:number[],n=14){
  if(xs.length<n+1)return NaN;let g=0,l=0;
  for(let i=xs.length-n;i<xs.length;i++){const d=xs[i]-xs[i-1];if(d>=0)g+=d;else l-=d}
  if(l===0)return 100;const rs=(g/n)/(l/n);return 100-100/(1+rs);
}
function atr(bs:Bar[],n=14){
  if(bs.length<n+1)return NaN;const x:number[]=[];
  for(let i=1;i<bs.length;i++)x.push(Math.max(bs[i].h-bs[i].l,Math.abs(bs[i].h-bs[i-1].c),Math.abs(bs[i].l-bs[i-1].c)));
  return mean(x.slice(-n));
}
function resample(bs:Bar[],mins:number){
  const step=mins*60,out:Bar[]=[];let cur:Bar|null=null;
  for(const b of bs){const t=Math.floor(b.t/step)*step;if(!cur||cur.t!==t){if(cur)out.push(cur);cur={t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}}else{cur.h=Math.max(cur.h,b.h);cur.l=Math.min(cur.l,b.l);cur.c=b.c;cur.v+=b.v}}
  if(cur)out.push(cur);return out;
}
function ct(ts:number){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(ts*1000));
  const o:any={};p.forEach(x=>o[x.type]=x.value);return {date:`${o.year}-${o.month}-${o.day}`,minute:Number(o.hour)*60+Number(o.minute),hour:Number(o.hour),min:Number(o.minute)};
}
function regularSession(bs:Bar[]){
  if(!bs.length)return[];const date=ct(bs[bs.length-1].t).date;
  return bs.filter(b=>{const p=ct(b.t);return p.date===date&&p.minute>=510&&p.minute<=900});
}
function cumulativeVwap(bs:Bar[]){
  let pv=0,v=0;return bs.map(b=>{pv+=b.c*b.v;v+=b.v;return v?pv/v:b.c});
}
function trend(bs:Bar[]){
  const cs=bs.map(b=>b.c),e8=emaSeries(cs,8),e21=emaSeries(cs,21);
  const fast=e8[e8.length-1],slow=e21[e21.length-1],rr=rsi(cs,14);
  return {state:fast>slow?"BULLISH":fast<slow?"BEARISH":"NEUTRAL",fast,slow,rsi:rr};
}
function fromOpen(q?:Quote){return q?.open&&q.mark!==null?pct(q.mark,q.open):q?.open&&q.last!==null?pct(q.last,q.open):0}

export function build0DteSignal(input:{
  minuteBars:Bar[];
  dailyBars:Bar[];
  quotes:Record<string,Quote>;
  highImpactLockout:boolean;
  highImpactReason?:string;
  nowMs?:number;
}){
  const session=regularSession(input.minuteBars);
  if(session.length<5)throw new Error("Not enough regular-session SPY bars");
  const last=session[session.length-1],prev=session[session.length-2]||last,nowMs=input.nowMs??Date.now();
  const now=ct(nowMs/1000),lastBarAgeSec=Math.max(0,nowMs/1000-last.t);
  const five=resample(session,5),fifteen=resample(session,15);
  const t5=trend(five),t15=trend(fifteen);
  const cs=session.map(b=>b.c),ema1_8=emaSeries(cs,8),lastEma1=ema1_8[ema1_8.length-1];
  const vwaps=cumulativeVwap(session),vwap=vwaps[vwaps.length-1],vwap10=vwaps[Math.max(0,vwaps.length-11)],vwapSlope=pct(vwap,vwap10);
  const vwapPct=pct(last.c,vwap),rsi5=rsi(five.map(b=>b.c),14),mom1=pct(last.c,prev.c);
  const orComplete=now.minute>=525;
  const first15=session.filter(b=>{const p=ct(b.t);return p.minute>=510&&p.minute<525});
  const orHigh=first15.length?Math.max(...first15.map(b=>b.h)):NaN,orLow=first15.length?Math.min(...first15.map(b=>b.l)):NaN;
  const orState=!orComplete?"FORMING":Number.isFinite(orHigh)&&last.c>orHigh?"ABOVE":Number.isFinite(orLow)&&last.c<orLow?"BELOW":"INSIDE";

  let crosses=0,prevSign=0;
  for(let i=Math.max(0,session.length-20);i<session.length;i++){
    const d=pct(session[i].c,vwaps[i]),sg=Math.abs(d)<.015?0:d>0?1:-1;
    if(sg&&prevSign&&sg!==prevSign)crosses++;if(sg)prevSign=sg;
  }

  const dailyAtr=atr(input.dailyBars,14),atrPct=Number.isFinite(dailyAtr)?dailyAtr/last.c*100:NaN;
  const overextended=Math.abs(vwapPct)>Math.max(.30,(Number.isFinite(atrPct)?atrPct*.35:.35))||rsi5>=80||rsi5<=20;

  const qqq=fromOpen(input.quotes.QQQ),iwm=fromOpen(input.quotes.IWM),vix=fromOpen(input.quotes.VIX);
  let score=0;const factors:SignalFactor[]=[];
  const add=(name:string,points:number,detail:string)=>{score+=points;factors.push({name,points,detail})};

  if(last.c>vwap)add("SPY vs VWAP",2,`+${vwapPct.toFixed(2)}% above VWAP`);else if(last.c<vwap)add("SPY vs VWAP",-2,`${vwapPct.toFixed(2)}% below VWAP`);
  if(vwapSlope>=.015)add("VWAP slope",1,`+${vwapSlope.toFixed(3)}% / 10m`);else if(vwapSlope<=-.015)add("VWAP slope",-1,`${vwapSlope.toFixed(3)}% / 10m`);
  if(t5.state==="BULLISH")add("5m EMA structure",2,"EMA 8 > EMA 21");else if(t5.state==="BEARISH")add("5m EMA structure",-2,"EMA 8 < EMA 21");
  if(t15.state==="BULLISH")add("15m EMA structure",2,"EMA 8 > EMA 21");else if(t15.state==="BEARISH")add("15m EMA structure",-2,"EMA 8 < EMA 21");
  if(orComplete&&orState==="ABOVE")add("15m opening range",2,"Above completed opening-range high");else if(orComplete&&orState==="BELOW")add("15m opening range",-2,"Below completed opening-range low");
  else if(!orComplete)factors.push({name:"15m opening range",points:0,detail:"Still forming until 8:45 CT"});
  if(Number.isFinite(rsi5)&&rsi5>=55&&rsi5<=75)add("5m RSI momentum",1,`RSI ${rsi5.toFixed(0)}`);else if(Number.isFinite(rsi5)&&rsi5>=25&&rsi5<=45)add("5m RSI momentum",-1,`RSI ${rsi5.toFixed(0)}`);
  if(qqq>=.03)add("QQQ confirmation",1,`+${qqq.toFixed(2)}% from open`);else if(qqq<=-.03)add("QQQ confirmation",-1,`${qqq.toFixed(2)}% from open`);
  if(iwm>=.03)add("IWM confirmation",1,`+${iwm.toFixed(2)}% from open`);else if(iwm<=-.03)add("IWM confirmation",-1,`${iwm.toFixed(2)}% from open`);
  if(vix<=-.10)add("VIX confirmation",1,`${vix.toFixed(2)}% from open`);else if(vix>=.10)add("VIX confirmation",-1,`+${vix.toFixed(2)}% from open`);

  const recent=session.slice(-4),touchOrHigh=orComplete&&Number.isFinite(orHigh)&&recent.some(b=>b.l<=orHigh*1.0008&&b.h>=orHigh*.9995);
  const touchOrLow=orComplete&&Number.isFinite(orLow)&&recent.some(b=>b.h>=orLow*.9992&&b.l<=orLow*1.0005);
  const prevVwap=vwaps[vwaps.length-2]??vwap;
  const callOr=orComplete&&orState==="ABOVE"&&touchOrHigh&&last.c>prev.c&&last.c>vwap;
  const putOr=orComplete&&orState==="BELOW"&&touchOrLow&&last.c<prev.c&&last.c<vwap;
  const callReclaim=prev.c<=prevVwap&&last.c>vwap&&t5.state==="BULLISH";
  const putReject=prev.c>=prevVwap&&last.c<vwap&&t5.state==="BEARISH";
  const nearSupport=Math.min(Math.abs(pct(last.c,vwap)),Math.abs(pct(last.c,lastEma1)))<=.12;
  const callPullback=t5.state==="BULLISH"&&last.c>vwap&&nearSupport&&pct(prev.c,session[Math.max(0,session.length-3)]?.c||prev.c)<=0&&mom1>0;
  const putPullback=t5.state==="BEARISH"&&last.c<vwap&&nearSupport&&pct(prev.c,session[Math.max(0,session.length-3)]?.c||prev.c)>=0&&mom1<0;

  let callTrigger:string|null=callOr?"OR_BREAKOUT_RETEST":callReclaim?"VWAP_RECLAIM":callPullback?"TREND_PULLBACK_RESUME":null;
  let putTrigger:string|null=putOr?"OR_BREAKDOWN_RETEST":putReject?"VWAP_REJECTION":putPullback?"TREND_BOUNCE_RESUME":null;

  if(overextended){
    if(callTrigger==="VWAP_RECLAIM"){}else if(callTrigger&&callTrigger!=="OR_BREAKOUT_RETEST"&&callTrigger!=="TREND_PULLBACK_RESUME")callTrigger=null;
    if(putTrigger==="VWAP_REJECTION"){}else if(putTrigger&&putTrigger!=="OR_BREAKDOWN_RETEST"&&putTrigger!=="TREND_BOUNCE_RESUME")putTrigger=null;
  }

  let directionalRaw:"CALL"|"PUT"|"WAIT"="WAIT",setup="WAIT — NO EDGE",trigger:string|null=null;
  if(score>=7){setup="CALL SETUP — WAIT FOR TRIGGER";if(callTrigger){directionalRaw="CALL";setup="BUY XSP CALL";trigger=callTrigger}}
  else if(score<=-7){setup="PUT SETUP — WAIT FOR TRIGGER";if(putTrigger){directionalRaw="PUT";setup="BUY XSP PUT";trigger=putTrigger}}

  const minutes=now.minute,marketOpen=minutes>=510&&minutes<=900,newEntryWindow=minutes>=515&&minutes<=630;
  const openingBlock=minutes>=510&&minutes<515,lateBlock=minutes>630;
  const chop=crosses>=4,stale=lastBarAgeSec>150;

  let raw=directionalRaw;
  let blockReason:string|null=null;
  if(!marketOpen)blockReason="MARKET CLOSED";
  else if(stale)blockReason="WAIT — STALE DATA";
  else if(openingBlock)blockReason="NO NEW ENTRIES — FIRST 5 MIN";
  else if(lateBlock)blockReason="NO NEW ENTRIES — AFTER 10:30 CT";
  else if(input.highImpactLockout)blockReason=`WAIT — EVENT RISK${input.highImpactReason?`: ${input.highImpactReason}`:""}`;
  else if(chop)blockReason="WAIT — CHOP";
  if(blockReason)raw="WAIT";

  return {
    raw,directionalRaw,setup:blockReason||setup,score:clamp(Math.round(score),-13,13),trigger,
    triggers:{call:callTrigger,put:putTrigger},
    eligibleForNewEntry:newEntryWindow&&!input.highImpactLockout&&!chop&&!stale,
    blockReason,overextended,chop,vwapCrosses20m:crosses,lastBarAgeSec,
    spy:{price:last.c,vwap,vwapPct,vwapSlope,open:session[0].o,orHigh,orLow,orState,orComplete,rsi5,momentum1:mom1,atrPct},
    timeframes:{m5:t5,m15:t15},
    confirmations:{qqqFromOpen:qqq,iwmFromOpen:iwm,vixFromOpen:vix},
    factors,nowCt:{date:now.date,hour:now.hour,minute:now.min,totalMinutes:now.minute}
  };
}
