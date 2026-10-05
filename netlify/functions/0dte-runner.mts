import type { Config } from "@netlify/functions";
import { getEquityFastContext } from "./lib/equity-data.mts";
import { tastyAccessToken, getMarketSnapshot, chooseXspContract, getOptionQuotes } from "./lib/tasty-0dte.mts";
import { build0DteSignal } from "./lib/0dte-signal.mts";
import { get0DteStore } from "./lib/0dte-store.mts";
import { get0DteEventState } from "./lib/0dte-events.mts";
import { getFutureFastContext } from "./lib/future-data.mts";
import { sendAll } from "./lib/push.mts";

type Position={
  id:string;direction:"CALL"|"PUT";contract:any;entryTime:string;entryMs:number;entrySpy:number;entryXsp:number;
  entryBid:number;entryAsk:number;entryMid:number;entryScore:number;entryTrigger:string|null;entrySnapshot:any;
  neutralCount:number;maxPnlPct:number;minPnlPct:number;lastBid:number|null;lastAsk:number|null;lastMid:number|null;
};
type State={date:string;entriesToday:number;lastExitMs:number|null;position:Position|null;lastAction:any|null};

function ctNow(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date(ms));
  const o:any={};p.forEach(x=>o[x.type]=x.value);
  return {date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour),minute:Number(o.minute),second:Number(o.second),total:Number(o.hour)*60+Number(o.minute),label:`${o.hour}:${o.minute}:${o.second} CT`};
}
const px=(q:any)=>q?.mark??q?.mid??q?.last??null;
const iso=()=>new Date().toISOString();
function safeNum(v:any){return Number.isFinite(Number(v))?Number(v):null}
function pnl(entry:number,exit:number){return {dollars:(exit-entry)*100,pct:entry>0?(exit/entry-1)*100:0}}
async function loadState(store:any,date:string):Promise<State>{
  const old=await store.get("state/current.json",{type:"json"}).catch(()=>null);
  if(old?.date===date)return old as State;
  return {date,entriesToday:0,lastExitMs:null,position:null,lastAction:null};
}
async function appendRaw(store:any,date:string,row:any){
  const key=`raw/${date}.json`;
  const xs=(await store.get(key,{type:"json"}).catch(()=>null))||[];
  const minuteKey=String(row.minuteKey);
  if(xs.length&&xs[xs.length-1]?.minuteKey===minuteKey)xs[xs.length-1]=row;else xs.push(row);
  await store.setJSON(key,xs);
}
async function appendTrade(store:any,trade:any){
  const key="trades/index.json",xs=(await store.get(key,{type:"json"}).catch(()=>null))||[];
  xs.push(trade);await store.setJSON(key,xs);
}
function entryAllowed(state:State,nowMs:number){
  const cooldown=!state.lastExitMs||nowMs-state.lastExitMs>=5*60_000;
  return state.entriesToday<3&&cooldown&&!state.position;
}

export default async()=>{
  const store=get0DteStore(),nowMs=Date.now(),now=ctNow(nowMs);
  try{
    let state=await loadState(store,now.date);
    if(now.total<510||now.total>900){
      const status={ok:true,version:"WTC XSP 0DTE V1",updatedAt:iso(),nowCt:now,session:"CLOSED",headline:"MARKET CLOSED",state};
      await store.setJSON("status/current.json",status);return;
    }
    if(now.total<515){
      const status={ok:true,version:"WTC XSP 0DTE V1",updatedAt:iso(),nowCt:now,session:"OPENING_BLOCK",headline:"NO NEW ENTRIES — FIRST 5 MIN",state};
      await store.setJSON("status/current.json",status);return;
    }

    const token=await tastyAccessToken();
    const [snapshot,bars,esBars]=await Promise.all([getMarketSnapshot(token),getEquityFastContext("SPY",token),getFutureFastContext("ES",token).catch(()=>null)]);
    const prelimEvent=await get0DteEventState(store,now.date,now.total);
    const signal=build0DteSignal({
      minuteBars:bars.minuteBars,dailyBars:bars.dailyBars,quotes:snapshot.quotes,
      esMinuteBars:esBars?.minuteBars||[],
      highImpactLockout:prelimEvent.highImpactLockout,
      highImpactReason:prelimEvent.active?.name,
      nowMs
    });

    const events=await get0DteEventState(store,signal.nowCt.date,signal.nowCt.totalMinutes);
    let optionQuote:any=null,action:any=null,currentPnl:any=null;
    const xspPrice=px(snapshot.quotes.XSP);

    if(state.position){
      const pos=state.position;
      const oq=(await getOptionQuotes([pos.contract.symbol],token))[0]||null;
      optionQuote=oq;
      if(oq?.bid!==null&&oq?.bid!==undefined){
        const bid=Number(oq.bid),ask=Number(oq.ask??bid),mid=Number(oq.mid??((bid+ask)/2));
        currentPnl=pnl(pos.entryAsk,bid);
        pos.lastBid=bid;pos.lastAsk=ask;pos.lastMid=mid;
        pos.maxPnlPct=Math.max(pos.maxPnlPct,currentPnl.pct);
        pos.minPnlPct=Math.min(pos.minPnlPct,currentPnl.pct);
        const againstNeutral=pos.direction==="CALL"?signal.score<=0:signal.score>=0;
        pos.neutralCount=againstNeutral?pos.neutralCount+1:0;

        const opposite=pos.direction==="CALL"?signal.directionalRaw==="PUT":signal.directionalRaw==="CALL";
        const structureInvalid=pos.direction==="CALL"
          ? signal.spy.price<signal.spy.vwap&&signal.timeframes.m5.state==="BEARISH"
          : signal.spy.price>signal.spy.vwap&&signal.timeframes.m5.state==="BULLISH";
        const emergency=currentPnl.pct<=-75;
        const forceEvent=Boolean(events.forceExitEvent);
        const forceTime=now.total>=885;
        const neutralExit=pos.neutralCount>=2;
        let reason:string|null=null;
        if(forceEvent)reason=`EVENT EXIT — ${events.forceExitEvent.name}`;
        else if(forceTime)reason="TIME EXIT — 2:45 CT";
        else if(emergency)reason="EMERGENCY BACKSTOP — -75%";
        else if(opposite)reason="OPPOSITE FULL SIGNAL";
        else if(structureInvalid)reason="VWAP + 5M STRUCTURE INVALIDATION";
        else if(neutralExit)reason="SCORE-ZERO HYSTERESIS EXIT";

        if(reason){
          const midPnl=pnl(pos.entryMid,mid);
          const trade={
            id:pos.id,version:"WTC XSP 0DTE V1",date:state.date,direction:pos.direction,setup:pos.entryTrigger,
            contract:pos.contract.symbol,strike:pos.contract.strike,expiration:pos.contract.expiration,optionType:pos.contract.optionType,
            entryTime:pos.entryTime,exitTime:iso(),durationMin:Math.max(0,Math.round((nowMs-pos.entryMs)/60000)),
            entrySpy:pos.entrySpy,exitSpy:signal.spy.price,entryXsp:pos.entryXsp,exitXsp:xspPrice,
            entryBid:pos.entryBid,entryAsk:pos.entryAsk,entryMid:pos.entryMid,exitBid:bid,exitAsk:ask,exitMid:mid,
            pnlDollars:currentPnl.dollars,pnlPct:currentPnl.pct,midPnlDollars:midPnl.dollars,midPnlPct:midPnl.pct,
            mfePct:pos.maxPnlPct,maePct:pos.minPnlPct,entryScore:pos.entryScore,exitScore:signal.score,exitReason:reason,
            entrySnapshot:pos.entrySnapshot,exitSnapshot:{spy:signal.spy,timeframes:signal.timeframes,confirmations:signal.confirmations},
            closedAt:iso()
          };
          await appendTrade(store,trade);
          state.position=null;state.lastExitMs=nowMs;state.lastAction={type:"EXIT",reason,tradeId:trade.id,time:iso(),pnlPct:trade.pnlPct,pnlDollars:trade.pnlDollars};
          action=state.lastAction;
          await sendAll({
            title:`WTC 0DTE · EXIT ${pos.direction}`,
            body:`${currentPnl.dollars>=0?"+":""}${currentPnl.dollars.toFixed(2)} (${currentPnl.pct>=0?"+":""}${currentPnl.pct.toFixed(1)}%) · ${reason}`,
            tag:`wtc-0dte-exit-${trade.id}`,
            url:"/",
            kind:"exit",
            signal:`EXIT ${pos.direction}`,
            ts:Date.now()
          }).catch(err=>console.error("0DTE exit push",err));
        }
      }
    }

    if(!state.position&&signal.raw!=="WAIT"&&signal.eligibleForNewEntry&&entryAllowed(state,nowMs)){
      if(xspPrice===null){
        action={type:"BLOCK",reason:"WAIT — XSP INDEX QUOTE UNAVAILABLE",time:iso()};
      }else{
        const pick=await chooseXspContract(signal.raw,xspPrice,token);
        const q=pick.quote,bid=safeNum(q?.bid),ask=safeNum(q?.ask),mid=safeNum(q?.mid);
        const spread=bid!==null&&ask!==null?ask-bid:Infinity;
        const spreadOk=mid!==null&&spread<=Math.max(.15,mid*.15);
        if(bid===null||ask===null||mid===null||ask<=0||!spreadOk){
          action={type:"BLOCK",reason:"WAIT — OPTION LIQUIDITY",time:iso(),spreadPct:pick.spreadPct};
        }else{
          const dir=signal.raw as "CALL"|"PUT",id=`${now.date}-${String(state.entriesToday+1).padStart(2,"0")}-${nowMs}`;
          const initial=pnl(ask,bid);
          const pos:Position={
            id,direction:dir,contract:pick.contract,entryTime:iso(),entryMs:nowMs,entrySpy:signal.spy.price,entryXsp:xspPrice,
            entryBid:bid,entryAsk:ask,entryMid:mid,entryScore:signal.score,entryTrigger:signal.trigger,
            entrySnapshot:{spy:signal.spy,timeframes:signal.timeframes,confirmations:signal.confirmations,factors:signal.factors,spreadPct:pick.spreadPct},
            neutralCount:0,maxPnlPct:initial.pct,minPnlPct:initial.pct,lastBid:bid,lastAsk:ask,lastMid:mid
          };
          state.position=pos;state.entriesToday++;state.lastAction={type:"ENTRY",direction:dir,tradeId:id,time:iso(),contract:pick.contract.symbol,ask};
          action=state.lastAction;optionQuote=q;currentPnl=initial;
          await sendAll({
            title:`WTC 0DTE · BUY ${dir}`,
            body:`XSP ${pick.contract.strike} ${dir==="CALL"?"C":"P"} @ ${ask.toFixed(2)} ask · score ${signal.score>0?"+":""}${signal.score} · ${signal.trigger||"confirmed trigger"}`,
            tag:`wtc-0dte-entry-${id}`,
            url:"/",
            kind:"entry",
            signal:`BUY ${dir}`,
            ts:Date.now()
          }).catch(err=>console.error("0DTE entry push",err));
        }
      }
    }

    const position=state.position;
    if(position&&optionQuote&&currentPnl===null&&optionQuote.bid!==null)currentPnl=pnl(position.entryAsk,Number(optionQuote.bid));
    const headline=position?`HOLD XSP ${position.direction}`:action?.type==="BLOCK"?action.reason:signal.setup;
    const status={
      ok:true,version:"WTC XSP 0DTE V1",updatedAt:iso(),nowCt:now,session:"REGULAR",
      headline,signal,eventRisk:events,state,position,optionQuote,currentPnl,xspPrice,marketQuotes:snapshot.quotes,lastAction:action||state.lastAction
    };

    const rawRow={
      minuteKey:`${now.date} ${String(now.hour).padStart(2,"0")}:${String(now.minute).padStart(2,"0")}`,
      timestamp:iso(),date:now.date,rawSignal:signal.raw,directionalRaw:signal.directionalRaw,headline:signal.setup,
      positionState:position?position.direction:"FLAT",score:signal.score,trigger:signal.trigger,spy:signal.spy,timeframes:signal.timeframes,
      confirmations:signal.confirmations,chop:signal.chop,eventLockout:events.highImpactLockout,blockReason:signal.blockReason,
      optionSymbol:position?.contract?.symbol||null,optionBid:optionQuote?.bid??null,optionAsk:optionQuote?.ask??null,
      modelPnlPct:currentPnl?.pct??null,action:action||null
    };

    await Promise.all([
      store.setJSON("state/current.json",state),
      store.setJSON("status/current.json",status),
      appendRaw(store,now.date,rawRow)
    ]);
  }catch(e:any){
    const error={ok:false,version:"WTC XSP 0DTE V1",updatedAt:iso(),nowCt:now,error:e?.message||String(e)};
    await store.setJSON("status/current.json",error).catch(()=>{});
    console.error("WTC 0DTE runner",e);
  }
};

export const config:Config={schedule:"* 13-21 * * 1-5"};
