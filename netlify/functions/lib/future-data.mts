import WebSocket from "ws";
import type { Bar } from "./equity-data.mts";

const BASE="https://api.tastyworks.com",UA="wtc-0dte/1.0";
const TX=1,RM=2,SB=4,SE=8,SS=16;
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
async function json(r:Response){return r.json().catch(()=>({}))}

async function future(token:string,productCode:string){
  const u=new URL(`${BASE}/instruments/futures`);
  u.searchParams.set("only-active-futures","true");
  u.searchParams.set("per-page","50");
  u.searchParams.append("product-code[]",productCode);
  const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
  const b:any=await json(r),items:any[]=b?.data?.items||[];
  if(!r.ok||!items.length)throw new Error(`${productCode} future lookup failed (${r.status})`);
  const tradeable=items.filter(x=>x?.["is-tradeable"]!==false&&x?.active!==false);
  const active=tradeable.find(x=>x?.["active-month"]===true);
  const sorted=[...tradeable].sort((a,b)=>Date.parse(a?.["stops-trading-at"]||a?.["expires-at"]||"9999-12-31")-Date.parse(b?.["stops-trading-at"]||b?.["expires-at"]||"9999-12-31"));
  const f=active||sorted[0]||items[0];
  if(!f?.symbol||!f?.["streamer-symbol"])throw new Error(`${productCode} streamer symbol missing`);
  return f;
}

async function quoteToken(token:string){
  const r=await fetch(`${BASE}/api-quote-tokens`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
  const b:any=await json(r),d=b?.data;
  if(!r.ok||!d?.token||!d?.["dxlink-url"])throw new Error(`future quote token failed (${r.status})`);
  return d;
}

type Candle={index:number;time:number;open:number|null;high:number|null;low:number|null;close:number|null;volume:number|null};
async function history(url:string,token:string,symbol:string,fromTime:number,minEvents:number){
  const cs=`${symbol}{=1m}`,fields=["eventType","eventSymbol","eventFlags","index","time","count","open","high","low","close","volume","vwap"];
  return await new Promise<Candle[]>((resolve,reject)=>{
    const ws=new WebSocket(url),map=new Map<number,Candle>();let pending:any[]=[],snap=false,done=false,sub=false,ef=fields;
    const timer=setTimeout(()=>finish(),12000);
    const cleanup=()=>{clearTimeout(timer);try{ws.close()}catch{}};
    const fail=(e:any)=>{if(done)return;done=true;cleanup();reject(e)};
    const finish=()=>{if(done)return;if(!map.size)return fail(new Error(`No ${cs} history`));done=true;cleanup();resolve([...map.values()].sort((a,b)=>a.time-b.time))};
    const send=(o:any)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))};
    const apply=()=>{for(const r of pending){if(r.flags&RM)map.delete(r.index);else map.set(r.index,{index:r.index,time:r.time,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume})}pending=[]};
    const row=(r:any)=>{if(r.flags&SB){pending=[];snap=true}const end=snap&&Boolean(r.flags&(SE|SS));if(end)snap=false;pending.push(r);if((r.flags&TX)||snap)return;if(end)map.clear();apply();if(map.size>=minEvents)setTimeout(finish,120)};
    ws.on("open",()=>send({type:"SETUP",channel:0,version:"0.1-DXF-JS/0.3.0",keepaliveTimeout:60,acceptKeepaliveTimeout:60}));
    ws.on("error",(e:any)=>fail(new Error(e?.message||"DXLink future error")));
    ws.on("message",(raw:any)=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}
      if(m?.type==="AUTH_STATE"&&m.state==="UNAUTHORIZED"){send({type:"AUTH",channel:0,token});return}
      if(m?.type==="AUTH_STATE"&&m.state==="AUTHORIZED"){send({type:"CHANNEL_REQUEST",channel:3,service:"FEED",parameters:{contract:"HISTORY"}});return}
      if(m?.type==="CHANNEL_OPENED"&&m.channel===3){send({type:"FEED_SETUP",channel:3,acceptDataFormat:"COMPACT",acceptEventFields:{Candle:fields}});return}
      if(m?.type==="FEED_CONFIG"&&m.channel===3){if(Array.isArray(m?.eventFields?.Candle))ef=m.eventFields.Candle;if(!sub){sub=true;send({type:"FEED_SUBSCRIPTION",channel:3,reset:true,add:[{type:"Candle",symbol:cs,fromTime}]})}return}
      if(m?.type==="FEED_DATA"&&m.channel===3&&Array.isArray(m.data)){const a=m.data;if(a[0]!=="Candle"||!Array.isArray(a[1]))return;const vals=a[1];for(let p=0;p+ef.length<=vals.length;p+=ef.length){const o:any={};ef.forEach((k:string,i:number)=>o[k]=vals[p+i]);const index=Number(o.index),time=Number(o.time);if(!Number.isFinite(index)||!Number.isFinite(time)||time<=0)continue;row({index,time,flags:Number(o.eventFlags)||0,open:num(o.open),high:num(o.high),low:num(o.low),close:num(o.close),volume:num(o.volume)})}}});
  });
}
function bars(xs:Candle[]):Bar[]{return xs.filter(x=>x.open!==null&&x.high!==null&&x.low!==null&&x.close!==null).map(x=>({t:Math.floor(x.time/1000),o:x.open!,h:x.high!,l:x.low!,c:x.close!,v:x.volume||0})).sort((a,b)=>a.t-b.t)}

export async function getFutureFastContext(productCode:string,accessToken:string){
  const [f,qt]=await Promise.all([future(accessToken,productCode),quoteToken(accessToken)]);
  const now=Date.now(),mins=await history(qt["dxlink-url"],qt.token,f["streamer-symbol"],now-2*24*3600e3,240);
  return {productCode,symbol:f.symbol,streamerSymbol:f["streamer-symbol"],minuteBars:bars(mins),source:"tastytrade DXLink / CME"};
}
