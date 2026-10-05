const BASE="https://api.tastyworks.com",UA="wtc-0dte/1.0";

export type Quote={
  symbol:string;instrumentType:string;bid:number|null;ask:number|null;mid:number|null;mark:number|null;last:number|null;
  open:number|null;prevClose:number|null;dayHigh:number|null;dayLow:number|null;updatedAt:string|null;
};
export type XspContract={symbol:string;strike:number;optionType:"C"|"P";expiration:string};

const n=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
async function body(r:Response){return r.json().catch(()=>({}))}

export async function tastyAccessToken(){
  const clientSecret=Netlify.env.get("TASTY_CLIENT_SECRET")?.trim();
  const refreshToken=Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
  if(!clientSecret||!refreshToken)throw new Error("Missing tastytrade credentials");
  const r=await fetch(`${BASE}/oauth/token`,{
    method:"POST",
    headers:{"User-Agent":UA,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({grant_type:"refresh_token",refresh_token:refreshToken,client_secret:clientSecret})
  });
  const b:any=await body(r);
  if(!r.ok||!b?.access_token)throw new Error(`tastytrade OAuth failed (${r.status})`);
  return b.access_token as string;
}

function normQuote(x:any):Quote{
  const bid=n(x?.bid),ask=n(x?.ask);
  const mid=bid!==null&&ask!==null?(bid+ask)/2:n(x?.mid);
  return {
    symbol:String(x?.symbol||""),
    instrumentType:String(x?.instrumentType||x?.["instrument-type"]||""),
    bid,ask,mid,mark:n(x?.mark),last:n(x?.last),
    open:n(x?.open),prevClose:n(x?.previousClose??x?.["previous-close"]??x?.prevClose),
    dayHigh:n(x?.dayHigh??x?.["day-high"]),dayLow:n(x?.dayLow??x?.["day-low"]),
    updatedAt:x?.updatedAt??x?.["updated-at"]??null
  };
}

export async function getMarketSnapshot(){
  const token=await tastyAccessToken();
  const q=new URLSearchParams();
  for(const s of ["SPY","QQQ","IWM"])q.append("equity[]",s);
  for(const s of ["XSP","VIX"])q.append("index[]",s);
  const r=await fetch(`${BASE}/market-data/by-type?${q.toString()}`,{
    headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}
  });
  const b:any=await body(r);
  if(!r.ok)throw new Error(`market snapshot failed (${r.status})`);
  const items=(b?.data?.items||[]).map(normQuote);
  const map:any={};
  for(const x of items)map[x.symbol]=x;
  return {token,quotes:map as Record<string,Quote>};
}

function ctDate(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o:any={};p.forEach(x=>o[x.type]=x.value);return `${o.year}-${o.month}-${o.day}`;
}

function expDate(x:any){
  return String(x?.["expiration-date"]??x?.expirationDate??x?.date??"").slice(0,10);
}
function strikeNum(x:any){
  return n(x?.["strike-price"]??x?.strikePrice??x?.strike);
}

async function nestedContracts(token:string,date:string):Promise<XspContract[]>{
  const r=await fetch(`${BASE}/option-chains/XSP/nested`,{
    headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}
  });
  const b:any=await body(r);
  if(!r.ok)return [];
  const out:XspContract[]=[];
  for(const root of b?.data?.items||[]){
    for(const ex of root?.expirations||[]){
      const d=expDate(ex);if(d!==date)continue;
      for(const st of ex?.strikes||[]){
        const strike=strikeNum(st);if(strike===null)continue;
        const call=st?.call??st?.["call-symbol"]??st?.callSymbol;
        const put=st?.put??st?.["put-symbol"]??st?.putSymbol;
        if(call)out.push({symbol:String(call),strike,optionType:"C",expiration:d});
        if(put)out.push({symbol:String(put),strike,optionType:"P",expiration:d});
      }
    }
  }
  return out;
}

async function flatContracts(token:string,date:string):Promise<XspContract[]>{
  const r=await fetch(`${BASE}/option-chains/XSP`,{
    headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}
  });
  const b:any=await body(r);if(!r.ok)return[];
  const out:XspContract[]=[];
  for(const x of b?.data?.items||[]){
    const d=expDate(x);if(d!==date)continue;
    const strike=strikeNum(x),typ=String(x?.["option-type"]??x?.optionType??"").toUpperCase();
    const symbol=String(x?.symbol||"");
    if(strike===null||!symbol||(typ!=="C"&&typ!=="P"))continue;
    out.push({symbol,strike,optionType:typ as "C"|"P",expiration:d});
  }
  return out;
}

export async function getSameDayXspContracts(token?:string){
  const t=token||await tastyAccessToken(),date=ctDate();
  let xs=await nestedContracts(t,date);
  if(!xs.length)xs=await flatContracts(t,date);
  if(!xs.length)throw new Error("No same-day XSP option chain found");
  return xs;
}

export async function getOptionQuotes(symbols:string[],token?:string){
  if(!symbols.length)return[] as Quote[];
  const t=token||await tastyAccessToken(),q=new URLSearchParams();
  for(const s of symbols.slice(0,100))q.append("equity-option[]",s);
  const r=await fetch(`${BASE}/market-data/by-type?${q.toString()}`,{
    headers:{Authorization:`Bearer ${t}`,"User-Agent":UA,Accept:"application/json"}
  });
  const b:any=await body(r);
  if(!r.ok)throw new Error(`option quote failed (${r.status})`);
  return (b?.data?.items||[]).map(normQuote) as Quote[];
}

export async function chooseXspContract(direction:"CALL"|"PUT",xspPrice:number,token?:string){
  const t=token||await tastyAccessToken(),all=await getSameDayXspContracts(t),typ=direction==="CALL"?"C":"P";
  const side=all.filter(x=>x.optionType===typ);
  if(!side.length)throw new Error("No matching XSP contracts");
  const preferred=side.filter(x=>direction==="CALL"?x.strike<=xspPrice:x.strike>=xspPrice)
    .sort((a,b)=>Math.abs(a.strike-xspPrice)-Math.abs(b.strike-xspPrice));
  const fallback=side.slice().sort((a,b)=>Math.abs(a.strike-xspPrice)-Math.abs(b.strike-xspPrice));
  const pool=(preferred.length?preferred:fallback).slice(0,4);
  const quotes=await getOptionQuotes(pool.map(x=>x.symbol),t),qm=new Map(quotes.map(q=>[q.symbol,q]));
  const ranked=pool.map(c=>({contract:c,quote:qm.get(c.symbol)})).filter((x:any)=>x.quote?.bid!==null&&x.quote?.ask!==null)
    .map((x:any)=>{
      const mid=(x.quote.bid+x.quote.ask)/2,spread=x.quote.ask-x.quote.bid,spreadPct=mid>0?spread/mid*100:Infinity;
      return {...x,mid,spread,spreadPct};
    })
    .sort((a:any,b:any)=>{
      const ap=a.spread<=Math.max(.15,a.mid*.15),bp=b.spread<=Math.max(.15,b.mid*.15);
      if(ap!==bp)return ap?-1:1;
      const da=Math.abs(a.contract.strike-xspPrice),db=Math.abs(b.contract.strike-xspPrice);
      return da-db||a.spreadPct-b.spreadPct;
    });
  if(!ranked.length)throw new Error("No quoted XSP contract");
  return ranked[0];
}
