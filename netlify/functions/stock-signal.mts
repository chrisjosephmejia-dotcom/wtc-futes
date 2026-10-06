import type { Context, Config } from "@netlify/functions";
import { getEquityBars, type Bar } from "./lib/equity-data.mts";

function ema(xs:number[],n:number){if(!xs.length)return NaN;const k=2/(n+1);let e=xs[0];for(let i=1;i<xs.length;i++)e=xs[i]*k+e*(1-k);return e}
function rsi(xs:number[],n=14){if(xs.length<n+1)return NaN;let g=0,l=0;for(let i=xs.length-n;i<xs.length;i++){const d=xs[i]-xs[i-1];if(d>=0)g+=d;else l-=d}if(l===0)return 100;const rs=(g/n)/(l/n);return 100-100/(1+rs)}
function atr(bs:Bar[],n=14){if(bs.length<n+1)return NaN;const tr:number[]=[];for(let i=1;i<bs.length;i++)tr.push(Math.max(bs[i].h-bs[i].l,Math.abs(bs[i].h-bs[i-1].c),Math.abs(bs[i].l-bs[i-1].c)));return tr.slice(-n).reduce((a,b)=>a+b,0)/n}
function clamp(x:number,a:number,b:number){return Math.max(a,Math.min(b,x))}
function pct(a:number,b:number){return b?((a/b)-1)*100:0}
function zone(center:number,widthPct:number){const h=center*(1+widthPct/200),l=center*(1-widthPct/200);return {low:Math.min(l,h),high:Math.max(l,h),center}}
function inside(p:number,z:any){return p>=z.low&&p<=z.high}

export default async(req:Request,_ctx:Context)=>{
  try{
    const u=new URL(req.url),ticker=(u.searchParams.get("ticker")||"PL").trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return Response.json({ok:false,error:"invalid_ticker"},{status:400});
    const d=await getEquityBars(ticker),daily=d.dailyBars;
    if(daily.length<60) throw new Error("Not enough daily history for Stock Trader");
    const closes=daily.map(b=>b.c),last=daily[daily.length-1],price=(d.minuteBars[d.minuteBars.length-1]?.c)||last.c;
    const a=atr(daily,14),atrPct=a/price*100,drsi=rsi(closes,14),e20=ema(closes.slice(-120),20),e50=ema(closes.slice(-220),50),e200=daily.length>=200?ema(closes,200):NaN;
    const lookback=daily.slice(-Math.min(252,daily.length)),high=Math.max(...lookback.map(b=>b.h)),low=Math.min(...lookback.map(b=>b.l));
    const dd=Math.max(0,(1-price/high)*100),move20=pct(price,daily[daily.length-21]?.c||price),move60=pct(price,daily[daily.length-61]?.c||price);
    const d1=clamp(atrPct*1.65,5,12),d2=clamp(d1*1.9,11,23),d3=clamp(d1*3.25,20,40),w=clamp(atrPct*.7,2,6);
    const z1=zone(high*(1-d1/100),w),z2=zone(high*(1-d2/100),w*1.12),z3=zone(high*(1-d3/100),w*1.25);
    const longTrend=Number.isFinite(e200)?(price>e200&&e50>e200?"BULLISH":price<e200&&e50<e200?"BEARISH":"MIXED"):(price>e50?"BULLISH":"MIXED");
    const damage=Number.isFinite(e200)&&price<e200-a*2&&e50<e200;
    const oversold=drsi<=38,extended=drsi>=72&&price>e20+a;
    let decision="WAIT • DIP DEVELOPING",tier="WAIT",reason="Price is above the first planned dip-buying zone.";
    if(inside(price,z1)){decision="BUY SMALL";tier="BUY_SMALL";reason="Price is inside the first volatility-adjusted dip zone."}
    else if(price<z1.low&&price>z2.high){decision="WAIT FOR LOWER";tier="WAIT";reason="The first dip zone has broken; wait for the deeper planned zone rather than chasing between levels."}
    else if(inside(price,z2)){decision=damage?"CAUTION • TREND DAMAGE":"BUY MORE";tier=damage?"CAUTION":"BUY_MORE";reason=damage?"Price reached the deeper zone, but long-term trend damage blocks an aggressive add.":"Price is inside the deeper volatility-adjusted add zone."}
    else if(price<z2.low&&price>z3.high){decision="WAIT FOR STRONGER DIP";tier="WAIT";reason="Price is between the deeper add zone and the strong-dip zone."}
    else if(inside(price,z3)){decision="STRONG DIP • THESIS RE-CHECK";tier="THESIS_CHECK";reason="Price reached the strong-dip zone. Cheap is not enough here; fresh thesis confirmation is required before a major add."}
    else if(price<z3.low){decision="CAUTION • BELOW STRONG-DIP ZONE";tier="CAUTION";reason="Price is below the planned strong-dip band. Treat this as possible thesis or structure damage, not automatically as a bargain."}
    if(price>z1.high&&extended){decision="WAIT • DO NOT CHASE";tier="WAIT";reason="Price is extended above the first dip zone and daily momentum is hot."}
    const qualityNote=daily.length<200?"LIMITED HISTORY • SIZE SMALLER":"TECHNICAL HISTORY AVAILABLE";
    const thesisRequired=tier==="THESIS_CHECK"||tier==="CAUTION";
    const score=Math.round(clamp(50-dd*1.1+(longTrend==="BULLISH"?12:longTrend==="BEARISH"?-12:0)+(oversold?8:0),0,100));
    return Response.json({
      ok:true,ticker,decision,tier,reason,score,source:d.source,updatedAt:new Date().toISOString(),
      price,
      regime:{longTrend,dailyRsi:drsi,atr:a,atrPct,drawdownFromHighPct:dd,move20Pct:move20,move60Pct:move60,ema20:e20,ema50:e50,ema200:Number.isFinite(e200)?e200:null,rangeHigh:high,rangeLow:low,historySessions:daily.length,qualityNote},
      zones:{anchorHigh:high,first:{...z1,label:"BUY SMALL",drawdownPct:d1},deeper:{...z2,label:"BUY MORE",drawdownPct:d2},strong:{...z3,label:"STRONG DIP",drawdownPct:d3}},
      thesis:{required:thesisRequired,status:thesisRequired?"REQUIRED":"NOT REQUIRED",note:thesisRequired?"Fresh business/news/filing thesis layer is the next build step.":"No strong-dip override is active."},
      model:{name:"WTC Stock Trader",version:"0.1-dev",philosophy:"Business quality controls conviction; price controls entry timing. Unproven is a sizing warning, not an automatic veto."}
    },{headers:{"Cache-Control":"no-store"}});
  }catch(e:any){return Response.json({ok:false,error:e?.message||String(e)},{status:503,headers:{"Cache-Control":"no-store"}})}
}
export const config:Config={path:"/api/stock-signal"};
