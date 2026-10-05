type RiskEvent={date:string;name:string;impact:"high"|"medium";description:string;source:string};
type PolyMarket={question:string;probability:number;direction:"bullish"|"bearish";volume:number};

const cache=new Map<string,{at:number;value:any}>();
const DAY=86400000,BASE="https://api.tastyworks.com",UA="wtc-options-seller/1.0";

function isoDate(d:Date){return d.toISOString().slice(0,10)}
function centralToday(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const o:any={};parts.forEach(p=>o[p.type]=p.value);return `${o.year}-${o.month}-${o.day}`}
function dateUTC(s:string){return new Date(s+"T12:00:00Z")}
function nextFriday(from:string){const d=dateUTC(from);const wd=d.getUTCDay();let add=(5-wd+7)%7;if(add===0)add=7;d.setUTCDate(d.getUTCDate()+add);return isoDate(d)}
function sessionsUntil(from:string,to:string){let n=0,d=dateUTC(from),end=dateUTC(to);d.setUTCDate(d.getUTCDate()+1);while(d<=end){const w=d.getUTCDay();if(w>=1&&w<=5)n++;d.setUTCDate(d.getUTCDate()+1)}return n}
function calendarDays(from:string,to:string){return Math.max(0,Math.round((dateUTC(to).getTime()-dateUTC(from).getTime())/DAY))}
function thirdFriday(year:number,month:number){const d=new Date(Date.UTC(year,month-1,1,12));let first=(5-d.getUTCDay()+7)%7;d.setUTCDate(1+first+14);return isoDate(d)}
function parseIcsDate(v:string){const m=v.match(/(\d{4})(\d{2})(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null}
async function readJson(r:Response){return r.json().catch(()=>({}))}

async function tastyToken(){
 const clientSecret=Netlify.env.get("TASTY_CLIENT_SECRET")?.trim(),refreshToken=Netlify.env.get("TASTY_REFRESH_TOKEN")?.trim();
 if(!clientSecret||!refreshToken)throw new Error("Missing tastytrade credentials");
 const r=await fetch(`${BASE}/oauth/token`,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({grant_type:"refresh_token",refresh_token:refreshToken,client_secret:clientSecret})});
 const b:any=await readJson(r);if(!r.ok||!b?.access_token)throw new Error("Tastytrade OAuth failed");return b.access_token as string;
}
async function listedWeeklyExpiry(ticker:string,today:string){
 try{
  const token=await tastyToken();
  const r=await fetch(`${BASE}/option-chains/${encodeURIComponent(ticker)}/nested`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":UA,Accept:"application/json"}});
  const b:any=await readJson(r);if(!r.ok)throw new Error("option chain");
  const exps:any[]=(b?.data?.items||[]).flatMap((x:any)=>Array.isArray(x?.expirations)?x.expirations:[]);
  const dates=exps.map((e:any)=>({date:String(e?.["expiration-date"]||e?.expirationDate||""),type:String(e?.["expiration-type"]||e?.expirationType||"")})).filter((x:any)=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.date>today);
  dates.sort((a:any,b:any)=>a.date.localeCompare(b.date));
  const fridays=dates.filter((x:any)=>dateUTC(x.date).getUTCDay()===5);
  const chosen=fridays[0]||dates[0];if(!chosen)throw new Error("no listed expiry");
  return {date:chosen.date,label:dateUTC(chosen.date).getUTCDay()===5?"Listed Friday expiry":"Nearest listed expiry",source:"tastytrade option chain",expirationType:chosen.type||null};
 }catch{
  return {date:nextFriday(today),label:"Upcoming Friday",source:"calendar fallback",expirationType:null};
 }
}
async function blsEvents(today:string,horizon:string):Promise<RiskEvent[]>{
 try{
  const r=await fetch("https://www.bls.gov/schedule/news_release/bls.ics",{headers:{"User-Agent":UA}});if(!r.ok)return[];
  const txt=await r.text(),blocks=txt.split("BEGIN:VEVENT").slice(1),out:RiskEvent[]=[];
  for(const b of blocks){
   const ds=b.match(/DTSTART[^:]*:([^\r\n]+)/)?.[1]||"",date=parseIcsDate(ds),summary=(b.match(/SUMMARY:([^\r\n]+)/)?.[1]||"").replace(/\\,/g,",").trim();if(!date||date<today||date>horizon)continue;
   let impact:"high"|"medium"|null=null,name=summary,desc="";
   if(/Employment Situation/i.test(summary)){impact="high";name="U.S. employment report";desc="Payrolls and unemployment can move index ETFs and option volatility."}
   else if(/Consumer Price Index/i.test(summary)){impact="high";name="Consumer Price Index";desc="Inflation data can move rates, index levels, and implied volatility."}
   else if(/Producer Price Index/i.test(summary)){impact="medium";name="Producer Price Index";desc="Wholesale inflation can move rates and short-premium pricing."}
   else if(/Job Openings and Labor Turnover/i.test(summary)){impact="medium";name="JOLTS report";desc="Labor-demand data can move rate expectations and index volatility."}
   else if(/Employment Cost Index/i.test(summary)){impact="medium";name="Employment Cost Index";desc="Wage inflation can affect rate expectations and broad-market volatility."}
   if(impact)out.push({date,name,impact,description:desc,source:"BLS"});
  }
  return out;
 }catch{return[]}
}
function fomcEvents(today:string,horizon:string):RiskEvent[]{const dates=["2026-10-28","2026-12-09","2027-01-27","2027-03-17","2027-04-28","2027-06-09","2027-07-28","2027-09-15","2027-10-27","2027-12-08"];return dates.filter(d=>d>=today&&d<=horizon).map(date=>({date,name:"Federal Reserve decision",impact:"high" as const,description:"FOMC rate decision and guidance can produce a broad volatility jump.",source:"Federal Reserve"}))}
function opexEvents(today:string,horizon:string):RiskEvent[]{const start=dateUTC(today),end=dateUTC(horizon),out:RiskEvent[]=[];let y=start.getUTCFullYear(),m=start.getUTCMonth()+1;while(true){const d=thirdFriday(y,m);if(d>=today&&d<=horizon)out.push({date:d,name:"Monthly options expiration",impact:"medium",description:"Expiration can amplify volume, gamma effects, and short-term pinning.",source:"Calculated"});if(d>horizon)break;m++;if(m===13){m=1;y++}if(new Date(Date.UTC(y,m-1,1))>end)break}return out}
function parseArr(v:any){if(Array.isArray(v))return v;try{return JSON.parse(v||"[]")}catch{return[]}}
async function polymarketOverlay(year:number){
 try{
  const slug=`spx-hit-dec-${year}`,r=await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`,{headers:{"User-Agent":UA}});if(!r.ok)throw new Error("gamma");
  const arr:any[]=await r.json(),ev=arr?.[0],markets:any[]=ev?.markets||[],picks:PolyMarket[]=[];
  for(const m of markets){
   if(m?.closed===true||m?.active===false)continue;
   const slug=String(m?.slug||"").toLowerCase(),q=String(m?.question||""),outcomes=parseArr(m?.outcomes),prices=parseArr(m?.outcomePrices).map(Number),yi=outcomes.findIndex((x:any)=>String(x).toLowerCase()==="yes"),p=yi>=0&&Number.isFinite(prices[yi])?prices[yi]:Number(m?.lastTradePrice);
   if(!Number.isFinite(p))continue;const dir=slug.includes("-high-")?"bullish":slug.includes("-low-")?"bearish":null;if(!dir)continue;picks.push({question:q,probability:p,direction:dir,volume:Number(m?.volumeNum||m?.volume||0)});
  }
  picks.sort((a,b)=>b.volume-a.volume);const shown=picks.slice(0,6),bull=shown.filter(x=>x.direction==="bullish"),bear=shown.filter(x=>x.direction==="bearish"),avg=(x:PolyMarket[])=>x.length?x.reduce((a,b)=>a+b.probability,0)/x.length:0,raw=(avg(bull)-avg(bear))*24,points=Math.max(-8,Math.min(8,Math.round(raw)));
  return {available:true,points,tilt:points>=2?"BULLISH":points<=-2?"BEARISH":"NEUTRAL",markets:shown,cap:8,eventTitle:ev?.title||"S&P 500 prediction markets"};
 }catch{return {available:false,points:0,tilt:"NEUTRAL",markets:[],cap:8,eventTitle:"S&P 500 prediction markets"}}
}
export async function getMarketContext(ticker="SPY"){
 const key=ticker.toUpperCase(),hit=cache.get(key);if(hit&&Date.now()-hit.at<300000)return hit.value;
 const today=centralToday(),h=new Date(dateUTC(today));h.setUTCDate(h.getUTCDate()+28);const horizon=isoDate(h);
 const [bls,poly,listed]=await Promise.all([blsEvents(today,horizon),polymarketOverlay(Number(today.slice(0,4))),listedWeeklyExpiry(key,today)]);
 const events=[...bls,...fomcEvents(today,horizon),...opexEvents(today,horizon)].sort((a,b)=>a.date.localeCompare(b.date)),expiry=listed.date,beforeExpiry=events.filter(e=>e.date<=expiry);
 const value={today,horizon,weeklyExpiry:{...listed,calendarDays:calendarDays(today,expiry),sessions:sessionsUntil(today,expiry)},events,eventsBeforeExpiry:beforeExpiry,polymarket:poly};
 cache.set(key,{at:Date.now(),value});return value;
}