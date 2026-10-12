import type { Config } from "@netlify/functions";
import { store } from "./lib/storage.mjs";
import { resolvePositionState, actionable, lifecycleLockActive, STRATEGY_VERSION } from "./lib/position-state.mjs";

const MULTIPLIER=2;
const FEE=1.72;

function round(n:number,d=2){ const p=10**d; return Math.round(n*p)/p; }

function rawFromEntry(e:any){
  return {
    checkedAt:e.checkedAt,
    signal:e.rawSignal || "WAIT",
    reason:e.rawReason || "—",
    score:e.score,
    price:e.price,
    market:{
      feedActive:e.feedActive,
      session:e.session,
      inEntry:e.inEntry,
    },
    daily:{state:e.dailyState || "MIXED"},
    frames:{
      "30m":{state:e.frame30 || null},
      "15m":{state:e.frame15 || null},
      "5m":{state:e.frame5 || null},
      "1m":{state:e.frame1 || null},
    },
    vwap:e.vwap,
    extension:{blocked:e.extensionBlocked},
    sourceContract:e.sourceContract,
  };
}

function closeTrade(t:any,e:any,current:any){
  const px=Number(e.price);
  if(!Number.isFinite(px)) return null;
  const side=t.direction==="BUY MNQ"?1:-1;
  const points=round((px-t.entryPrice)*side,2);
  const gross=round(points*MULTIPLIER,2);
  return {...t,status:"CLOSED",closedAt:e.checkedAt,exitPrice:px,exitScore:e.score,exitReason:current.reason,points,gross,net:round(gross-FEE,2)};
}

export default async () => {
  const s=store("mnq-engine");
  const listed:any=await s.list({prefix:"decision-log/"});
  const keys=(listed.blobs||[]).map((b:any)=>b.key).sort();
  const rows:any[]=[];
  for(const key of keys){
    const saved:any=await s.get(key,{type:"json"}) || {};
    for(const e of (Array.isArray(saved.entries)?saved.entries:[])){
      if(String(e?.strategyVersion||"").startsWith("WTC V3")) rows.push(e);
    }
  }
  rows.sort((a,b)=>String(a.checkedAt).localeCompare(String(b.checkedAt)));

  let previousSignal:any="WAIT";
  let riskLockDirection:any=null;
  let openTrade:any=null;
  const trades:any[]=[];
  const mismatches:any[]=[];

  for(const e of rows){
    const raw=rawFromEntry(e);
    const current:any=resolvePositionState(raw,previousSignal,openTrade,riskLockDirection);

    if(e.positionSignal && current.signal!==e.positionSignal){
      mismatches.push({checkedAt:e.checkedAt,logged:e.positionSignal,replayed:current.signal,rawSignal:e.rawSignal,score:e.score,reason:e.positionReason||null});
    }

    const previous=previousSignal;
    if(openTrade && (!actionable(current.signal) || current.signal!==openTrade.direction)){
      const closed=closeTrade(openTrade,e,current);
      if(closed){
        trades.push(closed);
        openTrade=null;
      }
    }

    if(actionable(current.signal) && !openTrade && Number.isFinite(Number(e.price))){
      openTrade={
        status:"OPEN",
        direction:current.signal,
        openedAt:e.checkedAt,
        entryPrice:Number(e.price),
        entryScore:Number.isFinite(Number(e.score))?Number(e.score):null,
        dailyState:e.dailyState || "MIXED",
      };
    }

    const nextRisk=current?.riskCap?.trigger
      ? (actionable(previous)?previous:null)
      : (lifecycleLockActive(raw,riskLockDirection)?riskLockDirection:null);
    riskLockDirection=nextRisk;
    previousSignal=current.signal;
  }

  if(openTrade) trades.push(openTrade);
  const closed=trades.filter(t=>t.status==="CLOSED");
  const gross=round(closed.reduce((a,t)=>a+Number(t.gross||0),0),2);
  const net=round(closed.reduce((a,t)=>a+Number(t.net||0),0),2);

  return new Response(JSON.stringify({
    ok:true,
    strategyVersion:STRATEGY_VERSION,
    replaySource:"per-minute decision log",
    rows:rows.length,
    firstDecision:rows[0]?.checkedAt||null,
    lastDecision:rows.at(-1)?.checkedAt||null,
    closedTrades:closed.length,
    openPosition:openTrade,
    grossPnl:gross,
    netPnlBeforeSlippage:net,
    mismatches:mismatches.length,
    mismatchSamples:mismatches.slice(-20),
    note:"Replay uses stored raw signal, score, price, feed/session state and V3 position-state rules. Engine-error rows preserve held positions instead of manufacturing exits."
  },null,2),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
};

export const config:Config={path:"/api/v3-replay"};
