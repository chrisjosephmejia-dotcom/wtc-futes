import { getNqBars, type Bar } from "./nq-data.mjs";

type Side = "BUY" | "SELL" | "NEUTRAL";

const TZ = "America/Chicago";

function pct(a:number,b:number){ return b ? ((a/b)-1)*100 : 0; }
function round(n:number,d=2){ const p=10**d; return Math.round(n*p)/p; }
function avg(xs:number[]){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }

function parts(ts:number|Date){
  const d = ts instanceof Date ? ts : new Date(ts*1000);
  const out:Record<string,string> = {};
  for (const p of new Intl.DateTimeFormat("en-US",{
    timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  }).formatToParts(d)) out[p.type]=p.value;
  return {
    date:`${out.year}-${out.month}-${out.day}`,
    weekday:out.weekday,
    hour:Number(out.hour), minute:Number(out.minute), second:Number(out.second),
    label:`${out.hour}:${out.minute}:${out.second} CT`
  };
}
function mins(p:ReturnType<typeof parts>){ return p.hour*60+p.minute; }
function weekday(p:ReturnType<typeof parts>){ return !["Sat","Sun"].includes(p.weekday); }
function entryWindow(p:ReturnType<typeof parts>){
  const m=mins(p);
  return weekday(p) && ((m>=8*60+35&&m<=10*60+30)||(m>=13*60+30&&m<=14*60+45));
}
function regularSession(p:ReturnType<typeof parts>){
  const m=mins(p); return weekday(p)&&m>=8*60+30&&m<=15*60+5;
}
function timeReason(p:ReturnType<typeof parts>){
  if(!weekday(p)) return "WEEKEND";
  const m=mins(p);
  if(m<8*60+30) return "PREMARKET";
  if(m<8*60+35) return "FIRST 5M BLOCK";
  if(m>10*60+30&&m<13*60+30) return "MIDDAY BLOCK";
  if(m>14*60+45&&m<=15*60+5) return "CLOSE BLOCK";
  if(m>15*60+5) return "CASH SESSION CLOSED";
  return "OUTSIDE ENTRY WINDOW";
}

function ema(values:number[],n:number){
  if(!values.length) return [] as number[];
  const k=2/(n+1), out=[values[0]];
  for(let i=1;i<values.length;i++) out.push(values[i]*k+out[i-1]*(1-k));
  return out;
}
function rsi(values:number[],n=14){
  if(values.length<2) return 50;
  const start=Math.max(1,values.length-n);
  let gain=0,loss=0,count=0;
  for(let i=start;i<values.length;i++){
    const d=values[i]-values[i-1];
    if(d>0) gain+=d; else loss-=d;
    count+=1;
  }
  if(!count) return 50;
  const ag=gain/count,al=loss/count;
  if(al===0) return 100;
  return 100-(100/(1+ag/al));
}
function macd(values:number[]){
  const e12=ema(values,12),e26=ema(values,26);
  const line=values.map((_,i)=>e12[i]-e26[i]);
  const sig=ema(line,9);
  return {line:line.at(-1)||0,signal:sig.at(-1)||0};
}
function atr(bars:Bar[],n=14){
  const start=Math.max(1,bars.length-n),tr:number[]=[];
  for(let i=start;i<bars.length;i++){
    const prev=bars[i-1].c,b=bars[i];
    tr.push(Math.max(b.h-b.l,Math.abs(b.h-prev),Math.abs(b.l-prev)));
  }
  return avg(tr);
}
function resample(bars:Bar[],minutes:number){
  const seconds=minutes*60,map=new Map<number,Bar>();
  for(const b of bars){
    const k=Math.floor(b.t/seconds)*seconds,x=map.get(k);
    if(!x) map.set(k,{...b,t:k});
    else { x.h=Math.max(x.h,b.h); x.l=Math.min(x.l,b.l); x.c=b.c; x.v+=b.v; }
  }
  return [...map.values()].sort((a,b)=>a.t-b.t);
}
function tfState(bars:Bar[],trigger=false){
  const c=bars.map(b=>b.c);
  if(c.length<30) return {state:"NEUTRAL" as Side,score:0,rsi:50,ema:"MIXED",macd:"flat",move:0};
  const e9=ema(c,9),e21=ema(c,21),m=macd(c),rr=rsi(c,14);
  let s=0;
  s+=e9.at(-1)!>e21.at(-1)!?1:-1;
  if(rr>55)s+=1;else if(rr<45)s-=1;
  s+=m.line>m.signal?1:-1;
  s+=c.at(-1)!>c.at(-2)!?1:-1;
  s+=e9.at(-1)!>e9.at(-2)!?1:-1;
  const threshold=trigger?2:3;
  const state:Side=s>=threshold?"BUY":s<=-threshold?"SELL":"NEUTRAL";
  return {state,score:s,rsi:round(rr,0),ema:e9.at(-1)!>e21.at(-1)!?"BULL":"BEAR",macd:m.line>m.signal?"UP":"DOWN",move:round(pct(c.at(-1)!,c.at(-2)!),2)};
}
function dailyState(bars:Bar[]){
  const c=bars.map(b=>b.c);
  if(c.length<55) return {state:"MIXED",rsi:50,ema20:0,ema50:0};
  const e20=ema(c,20).at(-1)!,e50=ema(c,50).at(-1)!,rr=rsi(c,14),last=c.at(-1)!;
  let state="MIXED";
  if(last>e50&&e20>e50&&rr>=50) state="BULLISH";
  if(last<e50&&e20<e50&&rr<=50) state="BEARISH";
  return {state,rsi:round(rr,0),ema20:round(e20,2),ema50:round(e50,2)};
}
function sessionBars(all:Bar[]){
  if(!all.length) return [] as Bar[];
  const lastDate=parts(all.at(-1)!.t).date;
  return all.filter(b=>{
    const p=parts(b.t),m=mins(p);
    return p.date===lastDate&&m>=8*60+30&&m<=15*60;
  });
}
function vwap(bars:Bar[]){
  let pv=0,vol=0;
  for(const b of bars){ const typical=(b.h+b.l+b.c)/3; pv+=typical*b.v; vol+=b.v; }
  return vol?pv/vol:(bars.at(-1)?.c||0);
}
function openingRange(bars:Bar[]){
  const first=bars.filter(b=>{const m=mins(parts(b.t));return m>=8*60+30&&m<8*60+45;});
  if(!first.length) return {low:0,high:0,mid:0};
  const low=Math.min(...first.map(b=>b.l)),high=Math.max(...first.map(b=>b.h));
  return {low,high,mid:(low+high)/2};
}

export async function computeSignal(){
  const now=new Date(),np=parts(now),inEntry=entryWindow(np),session=regularSession(np);
  const nq=await getNqBars();
  const minuteBars=nq.minuteBars,dailyBars=nq.dailyBars;
  if(!minuteBars.length) throw new Error("No NQ intraday bars returned");
  const sess=sessionBars(minuteBars);
  if(!sess.length) throw new Error("No NQ regular-session bars returned");

  const last=sess.at(-1)!,lp=parts(last.t),ageSec=Math.max(0,(Date.now()/1000)-last.t);
  const sameDay=np.date===lp.date;
  const feedActive=session&&sameDay&&ageSec<=300;
  const price=last.c,open=sess[0].o,vw=vwap(sess),or=openingRange(sess);
  const b5=resample(minuteBars,5),b15=resample(minuteBars,15),b30=resample(minuteBars,30);
  const t30=tfState(b30),t15=tfState(b15),t5=tfState(b5),t1=tfState(minuteBars,true),daily=dailyState(dailyBars);
  const closes=minuteBars.map(b=>b.c),e9=ema(closes,9).at(-1)!,e21=ema(closes,21).at(-1)!;
  const fromOpen=pct(price,open),m15=t15.move;
  const recentVol=sess.slice(-21,-1).map(b=>b.v).filter(v=>v>0),volRatio=recentVol.length?last.v/avg(recentVol):0;

  let score=0;
  score+=price>vw?2:-2;
  score+=e9>e21?2:-2;
  if(price>or.high)score+=2;else if(price<or.low)score-=2;
  if(fromOpen>=0.25)score+=1;else if(fromOpen<=-0.25)score-=1;
  if(m15>=0.05)score+=1;else if(m15<=-0.05)score-=1;
  if(daily.state==="BULLISH")score+=1;else if(daily.state==="BEARISH")score-=1;
  score=Math.max(-9,Math.min(9,score));

  const atrPct=price?atr(minuteBars,14)/price*100:0;
  const extensionPct=Math.abs(pct(price,vw));
  const extensionLimit=Math.max(0.45,Math.min(1.0,atrPct*6));
  const extended=extensionPct>extensionLimit;

  const thresholdFor=(side:Side)=>{
    if(daily.state==="MIXED") return 6;
    const aligned=(side==="BUY"&&daily.state==="BULLISH")||(side==="SELL"&&daily.state==="BEARISH");
    return aligned?5:7;
  };
  const buyThreshold=thresholdFor("BUY"),sellThreshold=thresholdFor("SELL");
  const buyAlignment=t30.state==="BUY"&&t15.state==="BUY"&&t5.state==="BUY"&&t1.state==="BUY"&&price>vw&&price>=or.mid;
  const sellAlignment=t30.state==="SELL"&&t15.state==="SELL"&&t5.state==="SELL"&&t1.state==="SELL"&&price<vw&&price<=or.mid;

  let signal:"BUY MNQ"|"SELL MNQ"|"WAIT"="WAIT",reason="ALIGNMENT CONFLICT";
  if(!session)reason=timeReason(np);
  else if(!feedActive)reason=`FEED PAUSED · LAST NQ BAR ${lp.label}`;
  else if(!inEntry)reason=timeReason(np);
  else if(extended)reason=`EXTENSION BLOCK · ${round(extensionPct,2)}% FROM VWAP`;
  else if(buyAlignment&&score>=buyThreshold){signal="BUY MNQ";reason=`ALL BULLISH · SCORE +${score}/${buyThreshold}`;}
  else if(sellAlignment&&score<=-sellThreshold){signal="SELL MNQ";reason=`ALL BEARISH · SCORE ${score}/-${sellThreshold}`;}
  else if((t30.state!==t15.state)||(t5.state==="NEUTRAL")||(t1.state==="NEUTRAL"))reason="TIMEFRAME CONFLICT · WAIT";
  else if(buyAlignment)reason=`BULLISH ALIGNMENT · SCORE +${score} < +${buyThreshold}`;
  else if(sellAlignment)reason=`BEARISH ALIGNMENT · SCORE ${score} > -${sellThreshold}`;

  return {
    checkedAt:now.toISOString(),checkedAtLabel:np.label,
    signal,reason,
    market:{feedActive,session,inEntry,lastBar:new Date(last.t*1000).toISOString(),lastBarLabel:lp.label,ageSec:Math.round(ageSec)},
    instrument:{symbol:nq.symbol,streamerSymbol:nq.streamerSymbol,exchange:nq.exchange,expirationDate:nq.expirationDate,minuteBars:minuteBars.length,dailyBars:dailyBars.length},
    price:round(price,2),fromOpen:round(fromOpen,2),open:round(open,2),vwap:round(vw,2),openingRange:{low:round(or.low,2),high:round(or.high,2)},
    score,scoreRange:"-9 to +9",threshold:{buy:buyThreshold,sell:sellThreshold},extension:{blocked:extended,pct:round(extensionPct,2),limitPct:round(extensionLimit,2)},
    volumeRatio:round(volRatio,1),daily,
    frames:{"30m":t30,"15m":t15,"5m":t5,"1m":t1},
    source:`${nq.source} ${nq.symbol}`,
    sourceNote:"Direct NQ futures candles from tastytrade/DXLink. Stale regular-session data is blocked."
  };
}
