/* Read-only position state + historical roll campaign viewer. Never sends orders. */
(()=>{
"use strict";
const existing=document.getElementById("wtc-positions-panel");
if(!existing)return;
const css=document.createElement("style");css.textContent=[
".wd-panel{border:1px solid #283850;background:#0e1829;border-radius:18px;padding:18px;margin:0 0 16px}",
".wd-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
".wd-top h2{font-size:17px;margin:0}",".wd-badge{font-size:12px;font-weight:900;padding:7px 10px;border-radius:99px;border:1px solid #506078}",
".wd-badge.normal{color:#4ee0a1;border-color:#345b4c}",".wd-badge.defense{color:#ff9696;border-color:#82444d}",
".wd-badge.watch{color:#ffd45a;border-color:#78642c}",".wd-small{color:#a3b3c8;font-size:12px;line-height:1.6;margin:9px 0}",
".wd-warn{color:#ffd45a;font-size:12px;line-height:1.6;margin:9px 0}",
".wd-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:12px 0}",
".wd-metric{border:1px solid #28374e;background:#0b1321;border-radius:11px;padding:11px}",
".wd-metric label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#95a5b9}",
".wd-metric strong{display:block;font-size:18px;margin-top:5px;overflow-wrap:anywhere}",
".wd-campaign{border:1px solid #293a52;background:#0b1322;padding:13px;border-radius:12px;margin-top:12px}",
".wd-campaign h3{font-size:14px;margin:0 0 8px}",
".wd-line{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin:7px 0}",
".wd-line span{color:#a3b3c8}",".wd-campaign summary{font-size:12px;color:#67d5ff;cursor:pointer}",
".wd-leg{font-size:11px;color:#a3b3c8;margin:4px 0}",
"@media(max-width:640px){.wd-metrics{grid-template-columns:1fr 1fr}}"
].join("\n");document.head.append(css);
const panel=document.createElement("section");panel.className="wd-panel";existing.insertAdjacentElement("afterend",panel);
let sheet=null,selected=(new URLSearchParams(location.search).get("ticker")||"SPY").toUpperCase();
if(selected!=="QQQ")selected="SPY";
const feeds={SPY:{},QQQ:{}};
const el=(tag,klass,text)=>{const x=document.createElement(tag);if(klass)x.className=klass;if(text!==undefined)x.textContent=String(text);return x};
const money=n=>typeof n==="number"&&Number.isFinite(n)?(n<0?"−":"")+"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
function chicagoSession(){
 const x=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
 const part=t=>x.find(i=>i.type===t)?.value||"";
 const minute=Number(part("hour"))*60+Number(part("minute"));
 return !["Sat","Sun"].includes(part("weekday")) && minute>=510 && minute<900;
}
function getPrice(t){
 const candidates=Object.values(feeds[t]).filter(x=>x&&Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.time)).sort((a,b)=>b.time-a.time);
 const data=candidates[0]||null,age=data?Date.now()-data.time:NaN;
 return {data,valid:chicagoSession()&&age>=-30000&&age<=300000};
}
function line(box,label,val){const x=el("div","wd-line");x.append(el("span","",label),el("strong","",val));box.append(x)}
function metric(box,label,val){const x=el("div","wd-metric");x.append(el("label","",label),el("strong","",val));box.append(x)}
function showCampaign(c){
 const box=el("div","wd-campaign");
 box.append(el("h3","",c.active?"Active rolling campaign":"Completed defensive campaign"));
 box.append(el("p","wd-small",c.started+" · "+c.rollCount+" linked rolls · ledger rows "+c.sourceRows.join(", ")));
 line(box,"Net opening premium received",money(c.openingCredits));
 line(box,"Completed BTC costs including fees",money(c.closeDebits));
 if(c.active){
  line(box,"Completed legs — realized P&L",money(c.realizedCompletedLegs));
  line(box,"Cash before current call buyback",money(c.cashBeforeOutstandingBuyback));
  box.append(el("p","wd-warn","Not net profit: current open short-call liability is excluded."));
 }else line(box,"Realized option-leg P&L",money(c.netRealizedIfCompleted));
 box.append(el("p","wd-small","Roll links inferred from ledger order and ROLLED outcomes; verify broker fills. Share gains/losses excluded."));
 if(c.assignmentRows?.length)box.append(el("p","wd-warn","Assignment economics are excluded."));
 const details=el("details","");details.append(el("summary","","Show individual legs"));
 const entries=el("div","");
 for(const l of c.legs){
  entries.append(el("div","wd-leg","Row "+l.row+" · "+l.contracts+" × $"+l.strike+" · "+l.expiration+" · "+l.status+" · "+(l.realizedPnl===null?"OPEN (unrealized)":money(l.realizedPnl))));
 }
 details.append(entries);box.append(details);return box;
}
function render(){
 panel.replaceChildren();
 const top=el("div","wd-top"),badge=el("span","wd-badge","DATA CHECK");
 top.append(el("h2","",selected+" · Automatic position state"),badge);panel.append(top);
 const intro=el("p","wd-small");panel.append(intro);
 if(!sheet){intro.textContent="Unlock or refresh the private spreadsheet to classify this account. No uncovered assumption.";return;}
 const rec=sheet.positions?.[selected],history=sheet.campaigns?.[selected];
 if(!rec||!history){intro.textContent="Ledger or campaign information unavailable. Refresh sheet.";return;}
 const opened=rec.openCalls||[],active=history.activeCampaigns||[],p=getPrice(selected);
 const leg=opened[0],campaign=leg?active.find(c=>c.sourceRows.includes(leg.sourceRow)):null;
 const age=Date.now()-Date.parse(sheet.readAt);
 const sheetOld=!Number.isFinite(age)||age<0||age>300000;
 const needsCheck=rec.safetyState==="RECONCILE"||Boolean(history.warnings?.length)||opened.length>1||
  (opened.length===1&&active.length!==1);
 let mode,reason;
 if(needsCheck){
  mode="RECONCILE";reason="Ledger status or roll-chain inconsistency: review saved trades and confirm with Robinhood.";
 }else if(sheetOld){
  mode="DATA CHECK";reason="The sheet was last read more than five minutes ago. Select Refresh sheet to update; this is not evidence of a trade mismatch.";
 }else if(opened.length===0){
  mode="UNCOVERED";reason="No open "+selected+" call RECORDED in Sheets. This is not broker confirmation that shares are uncovered.";
 }else if(campaign&&campaign.rollCount>0){
  mode="DEFENSE";reason="An active rolled campaign is recorded. Continue recovery monitoring even if the current strike is OTM; no automatic roll.";
 }else if(!p.valid){
  mode="DATA CHECK";reason="Underlying price is stale or not timestamp-verified for the current cash session. No strike-based state.";
 }else if(p.data.price>=leg.strike){
  mode="DEFENSE";reason="Underlying is at/above your short strike. Review risks and alternatives; do not roll automatically.";
 }else if((leg.strike-p.data.price)/leg.strike<=0.005){
  mode="STRIKE WATCH";reason="Underlying is within 0.5% below short strike. Watch price movement and days remaining.";
 }else{
  mode="NORMAL";reason="Open call is more than 0.5% below strike. Check 70% buyback using actual option quotes.";
 }
 badge.textContent=mode;badge.className="wd-badge "+(mode==="DEFENSE"?"defense":mode==="STRIKE WATCH"||mode==="RECONCILE"?"watch":mode==="NORMAL"?"normal":"");
 intro.textContent=reason;
 const m=el("div","wd-metrics");metric(m,"Open calls in sheet",opened.length?opened.map(x=>x.contracts).join("+"):"0");
 metric(m,"Short strike",leg?"$"+Number(leg.strike).toFixed(2):"—");
 metric(m,"Price reference",p.data?"$"+p.data.price.toFixed(2):"—");
 panel.append(m);
 const text=["Sheet read "+new Date(sheet.readAt).toLocaleTimeString()];
 if(p.data)text.push(p.data.source+" "+new Date(p.data.time).toLocaleTimeString()+(p.valid?"":" · stale/unverified"));
 if(leg){text.push("Expiration "+leg.expiration);if(p.data)text.push("Gap to strike "+((leg.strike-p.data.price)/leg.strike*100).toFixed(2)+"%");}
 panel.append(el("p","wd-small",text.join(" · ")));
 if(opened.length&&!p.valid)panel.append(el("p","wd-warn","No current market-session price. Refresh the market data; do not use stale quotes to choose rolls."));
 if(history.warnings?.length)panel.append(el("p","wd-warn",history.warnings.slice(0,3).join(" ")));
 if(campaign)panel.append(showCampaign(campaign));
 else if(active.length)for(const x of active.slice(0,2))panel.append(showCampaign(x));
 else if(history.recentRollingCampaigns?.length){
  const past=el("details","wd-campaign");past.append(el("summary","","Historical defensive campaigns — estimated linkage"));
  for(const c of history.recentRollingCampaigns)past.append(showCampaign(c));
  panel.append(past);
 }
 panel.append(el("p","wd-small","Observational only. Current option ask, 70% achieved, live roll credit, and brokerage share coverage are NOT verified. No trades or sheet edits."));
}
window.addEventListener("wtc:positions",e=>{sheet=e.detail?.positions?e.detail:null;render()});
window.addEventListener("wtc:symbol",e=>{if(["SPY","QQQ"].includes(e.detail?.ticker)){selected=e.detail.ticker;render()}});
window.addEventListener("wtc:market",e=>{
 const x=e.detail||{},t=x.ticker;if(t!=="SPY"&&t!=="QQQ")return;
 if(x.reset){feeds[t]={};render();return;}
 const k=x.kind==="vertex"?"vertex":"quote",ts=Date.parse(String(x.timestamp||""));
 if(!x.error&&Number.isFinite(Number(x.price))&&Number(x.price)>0){
  feeds[t][k]={price:Number(x.price),time:ts,source:k==="vertex"?"1-minute candle":"Tastytrade equity quote"};
 }else delete feeds[t][k];
 if(t===selected)render();
});
setInterval(render,30000);
render();
})();
