import type { Config } from "@netlify/functions";
import WebSocket from "ws";

const BASE = "https://api.tastyworks.com";
const UA = "wtc-futes/1.0";

async function json(res: Response) { return res.json().catch(()=>({})); }
async function credentials() {
  const clientSecret = Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken = Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if (!clientSecret || !refreshToken) throw new Error("Missing tastytrade environment variables");
  const auth = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {"User-Agent":UA,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({grant_type:"refresh_token",refresh_token:refreshToken,client_secret:clientSecret}),
  });
  const body: any = await json(auth);
  if (!auth.ok || !body?.access_token) throw new Error(`OAuth HTTP ${auth.status}`);
  const headers = {Authorization:`Bearer ${body.access_token}`,"User-Agent":UA,Accept:"application/json"};
  const instruments = new URL(`${BASE}/instruments/futures`);
  instruments.searchParams.set("only-active-futures","true");
  instruments.searchParams.append("product-code[]","NQ");
  instruments.searchParams.set("per-page","50");
  const [inst,quotes] = await Promise.all([
    fetch(instruments,{headers}),
    fetch(`${BASE}/api-quote-tokens`,{headers}),
  ]);
  const instBody:any = await json(inst), quoteBody:any = await json(quotes);
  if (!inst.ok || !quotes.ok) throw new Error(`Instrument/quote token HTTP ${inst.status}/${quotes.status}`);
  const items:any[] = instBody?.data?.items || [];
  const future = items.find((x:any)=>x?.["active-month"]===true) || items[0];
  const token = quoteBody?.data;
  if (!future?.symbol || !future?.["streamer-symbol"] || !token?.token || !token?.["dxlink-url"]) throw new Error("Missing symbol/quote connection");
  return {future, token};
}

async function probeTimeAndSale(url:string,token:string,symbol:string,lookbackMinutes:number) {
  const requested = ["eventType","eventSymbol","eventFlags","index","time","price","size","type","validTick","extendedTradingHours"];
  return new Promise<any>((resolve,reject)=>{
    const ws=new WebSocket(url);
    let finished=false, subscribed=false, snapshotEnded=false,received=0,events=0,valid=0;
    let latestTime=0,earliestTime=Infinity,latestPrice:number|null=null;
    const minuteBuckets = new Map<number,number>();
    let snapshotBoundaryAt:number|null=null, snapshotEvents=0;
    let eventFields=requested;
    const begin=Date.now(),fromTime=begin-lookbackMinutes*60_000;
    const timer=setTimeout(finish,10000);
    function cleanup(){clearTimeout(timer);try{ws.close()}catch{}}
    function finish(){if(finished)return;finished=true;cleanup();resolve({
      subscribed,snapshotEnded,receivedMessages:received,events,validTrades:valid,
      earliest:earliestTime<Infinity?new Date(earliestTime).toISOString():null,
      latest:latestTime?new Date(latestTime).toISOString():null,
      latestAgeSec:latestTime?Math.round((Date.now()-latestTime)/1000):null,
      latestPrice,
      minuteCoverage:minuteBuckets.size,
      firstMinuteCounts:[...minuteBuckets.entries()].sort((a,b)=>a[0]-b[0]).slice(0,8).map(([time,count])=>({time:new Date(time).toISOString(),count})),
      lastMinuteCounts:[...minuteBuckets.entries()].sort((a,b)=>a[0]-b[0]).slice(-8).map(([time,count])=>({time:new Date(time).toISOString(),count})),
      snapshotBoundaryAt:snapshotBoundaryAt?new Date(snapshotBoundaryAt).toISOString():null,
      snapshotEvents,
      fieldNames:eventFields,
      elapsedMs:Date.now()-begin,
    })}
    function send(x:any){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(x))}
    ws.on("error",(e:any)=>{if(!finished){finished=true;cleanup();reject(new Error("DXLink websocket: "+(e?.message||e)))}})
    ws.on("message",(raw)=>{
      received++;
      let m:any;
      try{m=JSON.parse(raw.toString())}catch{return}
      if(m.type==="AUTH_STATE"&&m.state==="UNAUTHORIZED"){send({type:"AUTH",channel:0,token});return}
      if(m.type==="AUTH_STATE"&&m.state==="AUTHORIZED"){
        send({type:"CHANNEL_REQUEST",channel:3,service:"FEED",parameters:{contract:"HISTORY"}});return
      }
      if(m.type==="CHANNEL_OPENED"&&m.channel===3){
        send({type:"FEED_SETUP",channel:3,acceptDataFormat:"COMPACT",acceptEventFields:{TimeAndSale:requested}});return
      }
      if(m.type==="FEED_CONFIG"&&m.channel===3){
        const fields=m.eventFields?.TimeAndSale;
        if(Array.isArray(fields)&&fields.length) eventFields=fields;
        if(!subscribed){subscribed=true;send({type:"FEED_SUBSCRIPTION",channel:3,reset:true,add:[{type:"TimeAndSale",symbol,fromTime}]})}
        return
      }
      if(m.type==="FEED_DATA"&&m.channel===3&&Array.isArray(m.data)&&m.data[0]==="TimeAndSale"&&Array.isArray(m.data[1])){
        const values=m.data[1];
        for(let i=0;i+eventFields.length<=values.length;i+=eventFields.length){
          const row:any={};for(let j=0;j<eventFields.length;j++) row[eventFields[j]]=values[i+j];
          const t=Number(row.time),p=Number(row.price),size=Number(row.size);
          events++;
          if(Number.isFinite(t)&&t>0){
            earliestTime=Math.min(earliestTime,t);
            const minute=Math.floor(t/60000)*60000;
            minuteBuckets.set(minute,(minuteBuckets.get(minute)||0)+1);
            if(t>=latestTime){latestTime=t;latestPrice=Number.isFinite(p)?p:null;}
          }
          if(Number.isFinite(p)&&p>0&&Number.isFinite(size)&&size>0&&row.validTick!==false) valid++;
          if(!snapshotEnded) snapshotEvents++;
          if((Number(row.eventFlags)||0)&(0x08|0x10)) {snapshotEnded=true;snapshotBoundaryAt=t;}
        }
        if(snapshotEnded) setTimeout(finish,150);
      }
      if(m.type==="ERROR"||m.type==="CHANNEL_CLOSED"){console.warn("NQ TimeAndSale probe event",JSON.stringify({type:m.type,channel:m.channel,error:m.error}))}
    });
    ws.on("open",()=>send({type:"SETUP",channel:0,version:"0.1-DXF-JS/0.3.0",keepaliveTimeout:60,acceptKeepaliveTimeout:60}))
  })
}

export default async (_req:Request) => {
  try {
    const {future,token}=await credentials();
    const q = new URL(_req.url).searchParams;
    const lookbackMinutes = Math.max(1,Math.min(120,Number(q.get("lookbackMinutes")) || 5));
    const result=await probeTimeAndSale(token["dxlink-url"],token.token,future["streamer-symbol"],lookbackMinutes);
    return Response.json({ok:Boolean(result.events&&result.latestAgeSec!=null&&result.latestAgeSec<120),symbol:future.symbol,lookbackMinutes,...result},{headers:{"Cache-Control":"no-store"}});
  }catch(error:any){return Response.json({ok:false,error:error?.message||String(error)},{status:503,headers:{"Cache-Control":"no-store"}})}
};
export const config:Config={path:"/api/nq-trades-probe"};
