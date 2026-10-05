import type { Context, Config } from "@netlify/functions";
import { getEquityBars, type Bar } from "./lib/equity-data.mts";

function ema(xs:number[],n:number){if(!xs.length)return NaN;const k=2/(n+1);let e=xs[0];for(let i=1;i<xs.length;i++)e=xs[i]*k+e*(1-k);return e}
function rsi(xs:number[],n=14){if(xs.length<n+1)return NaN;let g=0,l=0;for(let i=xs.length-n;i<xs.length;i++){const d=xs[i]-xs[i-1];if(d>=0)g+=d;else l-=d}if(l===0)return 100;const rs=(g/n)/(l/n);return 100-100/(1+rs)}
function atr(bs:Bar[],n=14){if(bs.length<n+1)return NaN;const trs:number[]=[];for(let i=1;i<bs.length;i++)trs.push(Math.max(bs[i].h-bs[i].l,Math.abs(bs[i].h-bs[i-1].c),Math.abs(bs[i].l-bs[i-1].c)));return trs.slice(-n).reduce((a,b)=>a+b,0)/n}
function resample(bs:Bar[],mins:number){const step=mins*60,out:Bar[]=[];let cur:any=null;for(const b of bs){const k=Math.floor(b.t/step)*step;if(!cur||cur.t!==k){if(cur)out.push(cur);cur={t:k,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}}else{cur.h=Math.max(cur.h,b.h);cur.l=Math.min(cur.l,b.l);cur.c=b.c;cur.v+=b.v}}if(cur)out.push(cur);return out}
function pct(a:number,b:number){return b?((a/b)-1)*100:0}
function clamp(n:number,a=0,b=100){return Math.max(a,Math.min(b,n))}
function ctParts(ts:number){const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(ts*1000));const o:any={};p.forEach(x=>o[x.type]=x.value);return {date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour),minute:Number(o.minute)}}
function regularSession(bs:Bar[]){if(!bs.length)return[];const lastDate=ctParts(bs[bs.length-1].t).date;return bs.filter(b=>{const p=ctParts(b.t);const m=p.hour*60+p.minute;return p.date===lastDate&&m>=510&&m<=900})}
function trendState(bs:Bar[]){const c=bs.map(b=>b.c),e9=ema(c,9),e21=ema(c,21),rr=rsi(c,14);return {state:e9>e21&&rr>=52?"BULLISH":e9<e21&&rr<=48?"BEARISH":"NEUTRAL",fast:e9,slow:e21,rsi:rr}}
function realizedVol(d:Bar[]){const x=d.slice(-21);if(x.length<3)return NaN;const rs=[];for(let i=1;i<x.length;i++)rs.push(Math.log(x[i].c/x[i-1].c));const mean=rs.reduce((a,b)=>a+b,0)/rs.length;const v=rs.reduce((a,b)=>a+(b-mean)**2,0)/(rs.length-1);return Math.sqrt(v)*Math.sqrt(252)*100}

export default async(req:Request,_ctx:Context)=>{
 try{
  const u=new URL(req.url),ticker=(u.searchParams.get("ticker")||"SPY").trim().toUpperCase();
  if(!/^[A-Z][A-Z0-9./-]{0,9}$/.test(ticker))return Response.json({ok:false,error:"invalid_ticker"},{status:400});
  const d=await getEquityBars(ticker),mins=d.minuteBars,daily=d.dailyBars;
  const session=regularSession(mins);if(session.length<20)throw new Error("Not enough regular-session history");
  const five=resample(session,5),fifteen=resample(session,15),thirty=resample(session,30);
  const last=session[session.length-1],prev=session[session.length-2],last5=five[five.length-1],prev5=five[five.length-2];
  const lo=Math.min(...session.map(b=>b.l)),hi=Math.max(...session.map(b=>b.h)),range=hi-lo,loc=range?((last.c-lo)/range)*100:50;
  const vtot=session.reduce((a,b)=>a+b.v,0),vwap=vtot?session.reduce((a,b)=>a+b.c*b.v,0)/vtot:last.c,vwapPct=pct(last.c,vwap);
  const rsi5=rsi(five.map(b=>b.c),14),mom5=prev5?pct(last5.c,prev5.c):0,mom1=prev?pct(last.c,prev.c):0;
  const t30=trendState(thirty),t15=trendState(fifteen),t5=trendState(five);
  const dc=daily.map(b=>b.c),dema20=ema(dc,20),dema50=ema(dc,50),dema200=ema(dc,200),drsi=rsi(dc,14),a=atr(daily,14),atrPct=last.c?100*a/last.c:NaN,rv=realizedVol(daily);
  const d20=daily.slice(-20),d52=daily.slice(-252),r20Lo=Math.min(...d20.map(b=>b.l)),r20Hi=Math.max(...d20.map(b=>b.h)),r52Lo=Math.min(...d52.map(b=>b.l)),r52Hi=Math.max(...d52.map(b=>b.h));
  const pos20=(last.c-r20Lo)/(r20Hi-r20Lo)*100,pos52=(last.c-r52Lo)/(r52Hi-r52Lo)*100;
  const trend=last.c>dema50&&dema50>dema200?"BULLISH":last.c<dema50&&dema50<dema200?"BEARISH":"MIXED";
  const stretch=Math.max(.18,Math.min(.65,(Number.isFinite(atrPct)?atrPct:1)*.22));
  const formingStretch=Math.max(.06,stretch*.45);
  const highForming=(loc>=78&&vwapPct>=formingStretch)||loc>=90;
  const lowForming=(loc<=22&&vwapPct<=-formingStretch)||loc<=10;
  const downsideTurn=highForming&&rsi5>=55&&mom5<=-.03&&mom1<=0&&t5.state!=="BULLISH";
  const upsideTurn=lowForming&&rsi5<=45&&mom5>=.03&&mom1>=0&&t5.state!=="BEARISH";

  let cc=20,csp=20;const factors:any[]=[];
  function add(name:string,ccv:number,cspv:number,detail:string){cc+=ccv;csp+=cspv;factors.push({name,cc:ccv,csp:cspv,detail})}

  if(loc>=80)add("Session location",20,-8,`${loc.toFixed(0)}% of session range`);
  else if(loc>=70)add("Session location",12,-4,`${loc.toFixed(0)}% of session range`);
  else if(loc<=20)add("Session location",-8,20,`${loc.toFixed(0)}% of session range`);
  else if(loc<=30)add("Session location",-4,12,`${loc.toFixed(0)}% of session range`);

  if(vwapPct>=stretch)add("VWAP stretch",10,-5,`${vwapPct.toFixed(2)}% from VWAP`);
  else if(vwapPct>=.08)add("VWAP stretch",6,-3,`${vwapPct.toFixed(2)}% from VWAP`);
  else if(vwapPct<=-stretch)add("VWAP stretch",-5,10,`${vwapPct.toFixed(2)}% from VWAP`);
  else if(vwapPct<=-.08)add("VWAP stretch",-3,6,`${vwapPct.toFixed(2)}% from VWAP`);

  if(rsi5>=70)add("Intraday RSI",15,-6,`5m RSI ${rsi5.toFixed(0)}`);
  else if(rsi5>=60)add("Intraday RSI",8,-3,`5m RSI ${rsi5.toFixed(0)}`);
  else if(rsi5>=55)add("Intraday RSI",4,-2,`5m RSI ${rsi5.toFixed(0)}`);
  else if(rsi5<=30)add("Intraday RSI",-6,15,`5m RSI ${rsi5.toFixed(0)}`);
  else if(rsi5<=40)add("Intraday RSI",-3,8,`5m RSI ${rsi5.toFixed(0)}`);
  else if(rsi5<=45)add("Intraday RSI",-2,4,`5m RSI ${rsi5.toFixed(0)}`);

  if(trend==="BULLISH")add("Trend quality",4,6,"bullish daily structure");
  else if(trend==="BEARISH")add("Trend quality",6,4,"bearish daily structure");

  if(pos20>=80)add("Daily extension",5,-2,`daily RSI ${drsi.toFixed(0)} · ${pos20.toFixed(0)}% of 20d range`);
  else if(pos20<=20)add("Daily extension",-2,5,`daily RSI ${drsi.toFixed(0)} · ${pos20.toFixed(0)}% of 20d range`);

  if(Number.isFinite(rv)&&rv<15)add("Volatility backdrop",-2,-2,`${rv.toFixed(0)}% realized vol`);
  else if(Number.isFinite(rv)&&rv>=20&&rv<=55)add("Volatility backdrop",4,4,`${rv.toFixed(0)}% realized vol`);

  const today=pct(last.c,daily[daily.length-2]?.c||last.c);
  if(today>=.3)add("Current move",4,-2,`+${today.toFixed(2)}% today`);
  else if(today<=-.3)add("Current move",-2,4,`${today.toFixed(2)}% today`);

  if(highForming){
    if(mom5<=.03)add("Momentum deceleration",6,0,`5m momentum ${mom5.toFixed(2)}%`);
    else if(mom5>.12)add("Momentum still expanding",-4,0,`5m momentum +${mom5.toFixed(2)}%`);
    if(t5.state==="BULLISH")add("Upper trend pressure",4,0,"5m trend still bullish");
  }
  if(lowForming){
    if(mom5>=-.03)add("Momentum deceleration",0,6,`5m momentum ${mom5.toFixed(2)}%`);
    else if(mom5<-.12)add("Momentum still expanding",0,-4,`5m momentum ${mom5.toFixed(2)}%`);
    if(t5.state==="BEARISH")add("Lower trend pressure",0,4,"5m trend still bearish");
  }

  if(downsideTurn)add("Vertex turn",25,0,"upper-range rollover confirmed");
  else if(upsideTurn)add("Vertex turn",0,25,"lower-range rebound confirmed");
  else add("Vertex turn",0,0,"No intraday turn is confirmed");

  cc=clamp(Math.round(cc),15,100);csp=clamp(Math.round(csp),15,100);

  let decision="WAIT — NO EDGE",reason="The underlying is not at a sufficiently stretched and reversing intraday extreme.",formation:"NONE";
  if(highForming&&!downsideTurn&&cc>=50){decision="WAIT — UPSIDE VERTEX FORMING";reason="Covered-call setup is forming, but the upper-range rollover is not confirmed yet.";formation="UPSIDE"}
  if(lowForming&&!upsideTurn&&csp>=50){decision="WAIT — DOWNSIDE VERTEX FORMING";reason="Cash-secured-put setup is forming, but the lower-range rebound is not confirmed yet.";formation="DOWNSIDE"}
  if(downsideTurn&&cc>=60){decision="CC VERTEX";reason="Upside intraday extreme is stretched and a downside momentum turn is confirmed.";formation="CONFIRMED_CC"}
  if(upsideTurn&&csp>=60){decision="CSP VERTEX";reason="Downside intraday extreme is stretched and an upside momentum turn is confirmed.";formation="CONFIRMED_CSP"}

  const now=ctParts(Date.now()/1000),m=now.hour*60+now.minute,open=m>=510&&m<=900;
  if(!open){decision="WAIT — MARKET CLOSED";reason="Regular U.S. cash session is closed; wait for fresh intraday structure.";formation="NONE"}

  const bias=clamp(cc-csp,-100,100);
  return Response.json({
    ok:true,ticker,decision,reason,formation,
    readiness:{cc,csp,bias},
    turns:{upside:upsideTurn,downside:downsideTurn},
    intraday:{price:last.c,sessionLow:lo,sessionHigh:hi,sessionLocation:loc,vwap,vwapPct,rsi5,momentum5:mom5,momentum1:mom1,stretchThresholdPct:stretch,formingStretchPct:formingStretch},
    timeframes:{m30:t30,m15:t15,m5:t5},
    daily:{atrPct,trend,rsi:drsi,move5:pct(last.c,daily[daily.length-6]?.c||last.c),move20:pct(last.c,daily[daily.length-21]?.c||last.c),range20:pos20,range52:pos52,realizedVol:rv,ema20:dema20,ema50:dema50,ema200:dema200},
    factors,source:d.source,updatedAt:new Date().toISOString()
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e:any){return Response.json({ok:false,error:e?.message||String(e)},{status:503,headers:{"Cache-Control":"no-store"}})}
}
export const config:Config={path:"/api/vertex-signal"};
