/* Phase 1: read-only SPY/QQQ position viewer. Does not alter Vertex decision logic. */
(()=>{
"use strict";
const input=document.getElementById("tickerInput");
const analyze=document.getElementById("loadBtn");
const controls=document.querySelector(".controls");
if(!input||!analyze||!controls)return;
const style=document.createElement("style");
style.textContent=`
.wtc-symbols{display:inline-flex;gap:6px;border:1px solid #2b3952;background:#0f172a;padding:4px;border-radius:12px}
.wtc-symbols button{background:transparent;color:#cbd5e1;border:1px solid transparent;min-width:68px;border-radius:9px;padding:9px 18px;font-weight:850;cursor:pointer}
.wtc-symbols button[aria-pressed="true"]{background:#67d5ff;color:#09111e}
.wtc-positions{padding:18px;margin:12px 0 16px;border:1px solid #24324a;border-radius:18px;background:#0e1625}
.wtc-positions h2{margin:0 0 5px;font-size:17px}
.wtc-positions .wtc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.wtc-positions .wtc-note{font-size:12px;color:#94a3b8;line-height:1.45}
.wtc-positions button{border:1px solid #2b3952;background:#152238;color:#e2e8f0;border-radius:9px;padding:9px 12px;cursor:pointer;font-weight:700}
.wtc-positions button:hover{border-color:#67d5ff}
.wtc-positions .wtc-login{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}
.wtc-positions [hidden]{display:none !important}
.wtc-positions input{background:#090f1b;color:#fff;border:1px solid #2b3952;border-radius:9px;padding:10px 12px}
.wtc-positions .wtc-position{padding:12px;margin:10px 0 4px;border:1px solid #293950;background:#0b1321;border-radius:12px}
.wtc-positions .wtc-position strong{display:block;font-size:17px;margin:4px 0}
.wtc-positions .wtc-warning{color:#ffd45a}
.wtc-positions .wtc-success{color:#4ee0a1}
`;
document.head.append(style);
input.type="hidden";input.setAttribute("aria-hidden","true");
const buttons=document.createElement("div");buttons.className="wtc-symbols";buttons.setAttribute("role","group");buttons.setAttribute("aria-label","Underlying ETF");
const panel=document.createElement("section");panel.className="wtc-positions";panel.id="wtc-positions-panel";
panel.innerHTML=`
<div class="wtc-top"><div><h2>Covered-call positions · Google Sheets</h2><div class="wtc-note">Private, read-only ledger view. Not a brokerage position feed.</div></div><button id="wtc-refresh-positions" type="button">Refresh sheet</button></div>
<div id="wtc-position-status" class="wtc-note" role="status" style="margin-top:9px">Checking connection…</div>
<form id="wtc-position-login" class="wtc-login" hidden><label class="wtc-note" for="wtc-position-password">Private position password</label><input id="wtc-position-password" type="password" autocomplete="current-password" minlength="16" required/><button type="submit">Unlock positions</button></form>
<div id="wtc-position-content"></div>
<div id="wtc-position-footer" class="wtc-note" style="margin-top:10px"></div>
`;
const fallback=document.querySelector(".quoteHero");
if(fallback) fallback.insertAdjacentElement("beforebegin",panel);
else controls.insertAdjacentElement("afterend",panel);
let snapshot=null,current=(new URLSearchParams(location.search).get("ticker")||"SPY").toUpperCase();
if(!["SPY","QQQ"].includes(current))current="SPY";
for(const symbol of ["SPY","QQQ"]){
 const button=document.createElement("button");button.type="button";button.textContent=symbol;button.dataset.symbol=symbol;
 button.addEventListener("click",()=>{current=symbol;input.value=symbol;analyze.click();paint();});
 buttons.append(button);
}
controls.insertBefore(buttons,input);
const $=id=>document.getElementById(id);
function setStatus(text){$("wtc-position-status").textContent=text;}
function paint(){
 for(const b of buttons.querySelectorAll("button"))b.setAttribute("aria-pressed",String(b.dataset.symbol===current));
 const target=$("wtc-position-content");target.replaceChildren();
 if(!snapshot){$("wtc-position-footer").textContent="Confirm every same-day trade in Robinhood before selling another call.";return;}
 const record=snapshot.positions?.[current];
 if(!record){setStatus("No ledger data for "+current+".");return;}
 const top=document.createElement("p");top.className="wtc-note";
 top.textContent=current+" · "+record.account+" · last recorded opening "+(record.latestEntryDate||"unknown")+
   " · sheet read "+new Date(snapshot.readAt).toLocaleString();
 target.append(top);
 if(record.openCalls?.length){
   for(const p of record.openCalls){
     const div=document.createElement("div");div.className="wtc-position";
     const title=document.createElement("strong");title.textContent=p.contracts+" "+current+" $"+p.strike+" call"+(p.contracts>1?"s":"")+" · expires "+p.expiration;
     const detail=document.createElement("div");detail.className="wtc-note";detail.textContent=
       "Opened "+p.opened+" · entry $"+Number(p.entryPrice).toFixed(2)+"/share · 70% buyback target $"+
       Number(p.takeProfitBuybackPrice).toFixed(2)+"/share · ledger row "+p.sourceRow;
     div.append(title,detail);target.append(div);
   }
 }else{
   const note=document.createElement("p");note.className="wtc-note wtc-warning";
   note.textContent="No open "+current+" call recorded in this sheet. This is NOT proof your shares are uncovered.";
   target.append(note);
 }
 if(record.warnings?.length){
   const warning=document.createElement("p");warning.className="wtc-note wtc-warning";
   warning.textContent="RECONCILE: "+record.warnings.join(" ");
   target.append(warning);
 }
 $("wtc-position-footer").textContent="Entry targets are not live option marks. Always confirm position, share coverage, and recent fills directly in Robinhood. No trades are sent or logged by this panel.";
}
async function load(){
 setStatus("Reading latest saved entries from Google Sheets…");
 $("wtc-refresh-positions").disabled=true;
 try{
   const res=await fetch("/api/positions",{credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json"}});
   const data=await res.json().catch(()=>({error:"Server returned an invalid response"}));
   if(res.status===401){
     snapshot=null;$("wtc-position-login").hidden=false;
     setStatus("Private ledger is locked. Enter your site position password.");paint();return;
   }
   if(!res.ok)throw new Error(data.error||"Unable to read spreadsheet");
   $("wtc-position-login").hidden=true;
   snapshot=data;
   setStatus("Read-only sheet connection active · refreshed "+new Date(data.readAt).toLocaleTimeString());
   paint();
 }catch(error){
   snapshot=null;setStatus("Sheet connection: "+(error.message||"unavailable"));paint();
 }finally{$("wtc-refresh-positions").disabled=false;}
}
$("wtc-refresh-positions").addEventListener("click",load);
$("wtc-position-login").addEventListener("submit",async event=>{
 event.preventDefault();const pass=$("wtc-position-password").value;
 setStatus("Authenticating…");
 try{
   const res=await fetch("/api/positions",{method:"POST",credentials:"same-origin",
     headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",password:pass})});
   const data=await res.json();
   if(!res.ok)throw new Error(data.error||"Login unsuccessful");
   $("wtc-position-password").value="";
   await load();
 }catch(error){setStatus("Position login: "+(error.message||"failed"));}
});
input.value=current;
buttons.querySelector('[data-symbol="'+current+'"]')?.setAttribute("aria-pressed","true");
load();
})();
