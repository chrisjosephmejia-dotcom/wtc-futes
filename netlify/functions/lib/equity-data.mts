import WebSocket from "ws";

export type Bar={t:number;o:number;h:number;l:number;c:number;v:number};
const BASE="https://api.tastyworks.com", UA="wtc-stock-trader/1.0";
const TX=1, RM=2, SB=4, SE=8, SS=16;
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
async function json(r:Response){return r.json().catch(()=>({}));}

export async function accessToken(){
  const clientSecret=Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken=Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if(!clientSecret||!refreshToken) throw new Error("Missing tastytrade credentials");
  const r=await fetch(`${BASE}/oauth/token`,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({grant_type:"refresh_token",refresh_token:refreshToken,client_secret:clientSecret})});
  const b:any=await json(r);
  if(!r.ok||!b?.access_token) throw new Error(`OAuth failed (${r.status})`);
  return b.access_token as string;
}

async function equity(token:string,symbol:string){
  const r=await fetch(`${BASE}/instruments/equities/${encodeURIComponent(symbol)}`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
  const b:any=await json(r),d=b?.data;
  if(!r.ok||!d?.["streamer-symbol"]) throw new Error(`Equity lookup failed (${r.status})`);
  return d;
}

async function quoteToken(token:string){
  const r=await fetch(`${BASE}/api-quote-tokens`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
  const b:any=await json(r),d=b?.data;
  if(!r.ok||!d?.token||!d?.["dxlink-url"]) throw new Error(`Quote token failed (${r.status})`);
  return d;
}

type Candle={index:number;time:number;open:number|null;high:number|null;low:number|null;close:number|null;volume:number|null};

async function history(url:string,token:string,symbol:string,period:number,unit:"m"|"d",fromTime:number,minEvents:number){
  const cs=`${symbol}{=${period}${unit}}`;
  const fields=["eventType","eventSymbol","eventFlags","index","time","count","open","high","low","close","volume","vwap"];
  return await new Promise<Candle[]>((resolve,reject)=>{
    const ws=new WebSocket(url),map=new Map<number,Candle>();let pending:any[]=[],snap=false,done=false,sub=false,ef=fields;
    const timer=setTimeout(()=>finish(),12000);
    const cleanup=()=>{clearTimeout(timer);try{ws.close()}catch{}};
    const fail=(e:any)=>{if(done)return;done=true;cleanup();reject(e)};
    const finish=()=>{if(done)return;if(!map.size)return fail(new Error(`No ${cs} history`));done=true;cleanup();resolve([...map.values()].sort((a,b)=>a.time-b.time))};
    const send=(o:any)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))};
    const apply=()=>{for(const r of pending){if(r.flags&RM)map.delete(r.index);else map.set(r.index,{index:r.index,time:r.time,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume})}pending=[]};
    const row=(r:any)=>{if(r.flags&SB){pending=[];snap=true}const end=snap&&Boolean(r.flags&(SE|SS));if(end)snap=false;pending.push(r);if((r.flags&TX)||snap)return;if(end)map.clear();apply();if(end||map.size>=minEvents)setTimeout(finish,80)};
    ws.on("open",()=>send({type:"SETUP",channel:0,version:"0.1-DXF-JS/0.3.0",keepaliveTimeout:60,acceptKeepaliveTimeout:60}));
    ws.on("error",(e:any)=>fail(new Error(e?.message||"DXLink error")));
    ws.on("message",(raw:any)=>{let m:any;try{m=JSON.parse(raw.toString())}catch{return}
      if(m?.type==="AUTH_STATE"&&m.state==="UNAUTHORIZED"){send({type:"AUTH",channel:0,token});return}
      if(m?.type==="AUTH_STATE"&&m.state==="AUTHORIZED"){send({type:"CHANNEL_REQUEST",channel:3,service:"FEED",parameters:{contract:"HISTORY"}});return}
      if(m?.type==="CHANNEL_OPENED"&&m.channel===3){send({type:"FEED_SETUP",channel:3,acceptDataFormat:"COMPACT",acceptEventFields:{Candle:fields}});return}
      if(m?.type==="FEED_CONFIG"&&m.channel===3){if(Array.isArray(m?.eventFields?.Candle))ef=m.eventFields.Candle;if(!sub){sub=true;send({type:"FEED_SUBSCRIPTION",channel:3,reset:true,add:[{type:"Candle",symbol:cs,fromTime}]})}return}
      if(m?.type==="FEED_DATA"&&m.channel===3&&Array.isArray(m.data)){const a=m.data;if(a[0]!=="Candle"||!Array.isArray(a[1]))return;const vals=a[1];for(let p=0;p+ef.length<=vals.length;p+=ef.length){const o:any={};ef.forEach((k:string,i:number)=>o[k]=vals[p+i]);const index=Number(o.index),time=Number(o.time);if(!Number.isFinite(index)||!Number.isFinite(time)||time<=0)continue;row({index,time,flags:Number(o.eventFlags)||0,open:num(o.open),high:num(o.high),low:num(o.low),close:num(o.close),volume:num(o.volume)})}}});
  });
}

function bars(c:Candle[]):Bar[]{return c.filter(x=>x.open!==null&&x.high!==null&&x.low!==null&&x.close!==null).map(x=>({t:Math.floor(x.time/1000),o:x.open!,h:x.high!,l:x.low!,c:x.close!,v:x.volume||0})).sort((a,b)=>a.t-b.t)}

export async function getEquityBars(symbol:string){
  const at=await accessToken();
  const [eq,qt]=await Promise.all([equity(at,symbol),quoteToken(at)]);
  const ss=eq["streamer-symbol"],now=Date.now();
  const [mins,days]=await Promise.all([
    history(qt["dxlink-url"],qt.token,ss,1,"m",now-8*24*3600e3,300),
    history(qt["dxlink-url"],qt.token,ss,1,"d",now-420*24*3600e3,180)
  ]);
  return {symbol,streamerSymbol:ss,minuteBars:bars(mins),dailyBars:bars(days),source:"tastytrade DXLink"};
}


export async function getEquityDailyBars(symbol:string){
  const at=await accessToken();
  const [eq,qt]=await Promise.all([equity(at,symbol),quoteToken(at)]);
  const ss=eq["streamer-symbol"],now=Date.now();
  const days=await history(qt["dxlink-url"],qt.token,ss,1,"d",now-420*24*3600e3,200);
  return {symbol,streamerSymbol:ss,dailyBars:bars(days),source:"tastytrade DXLink"};
}
