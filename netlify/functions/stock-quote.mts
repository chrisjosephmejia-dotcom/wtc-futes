import type { Context, Config } from "@netlify/functions";
import { accessToken } from "./lib/equity-data.mts";

const BASE="https://api.tastyworks.com",UA="wtc-stock-trader/1.0";
const n=(v:any)=>Number.isFinite(Number(v))?Number(v):null;

export default async(req:Request,_ctx:Context)=>{
  try{
    const u=new URL(req.url),ticker=(u.searchParams.get("ticker")||"PL").trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return Response.json({ok:false,error:"invalid_ticker"},{status:400});
    const token=await accessToken(),q=new URL(`${BASE}/market-data/by-type`);
    q.searchParams.append("equity[]",ticker);
    const r=await fetch(q,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
    const b:any=await r.json().catch(()=>({})),x=b?.data?.items?.[0];
    if(!r.ok||!x) throw new Error(b?.error?.message||b?.message||`Quote failed (${r.status})`);
    const bid=n(x.bid),ask=n(x.ask),last=n(x.last),mark=n(x.mark),prev=n(x["prev-close"]);
    const price=mark??last??(bid!==null&&ask!==null?(bid+ask)/2:null);
    return Response.json({ok:true,ticker,price,bid,ask,last,mark,previousClose:prev,changePct:price!==null&&prev?((price/prev)-1)*100:null,open:n(x.open),dayHigh:n(x["day-high-price"]),dayLow:n(x["day-low-price"]),volume:n(x.volume),halted:x["is-trading-halted"]??null,updatedAt:x["updated-at"]||null,receivedAt:new Date().toISOString(),source:"tastytrade REST"},{headers:{"Cache-Control":"no-store"}});
  }catch(e:any){return Response.json({ok:false,error:e?.message||"unexpected_error"},{status:503,headers:{"Cache-Control":"no-store"}})}
}
export const config:Config={path:"/api/stock-quote"};
