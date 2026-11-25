/**
 * Read-only campaign accounting for WTC Options.
 *
 * A campaign follows adjacent calls of the SAME ticker and contract count
 * ONLY when the preceding leg explicitly says "rolled". A "closed" row
 * always terminates a campaign, even if another call opened on the same day.
 * Historical links are inferred from spreadsheet status/order; not independently
 * verified broker roll-order IDs. Never call opening credit realized P&L.
 */
type LegStatus = "open" | "closed" | "rolled" | "assigned" | "expired" | "exercised";
type Leg = {
  row:number; ticker:string; opened:string; expiry:string; strike:number;
  contracts:number; netOpening:number; closeDebit:number|null; status:LegStatus;
  notes:string;
};
const value=(x:unknown)=>String(x??"").trim();
const money=(x:unknown)=>{const n=Number(value(x).replace(/[$,\s]/g,""));return Number.isFinite(n)?n:null;};
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function date(x:unknown){
 const v=value(x),m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
 if(!m)return null;
 const y=+m[3],mm=+m[1],dd=+m[2],d=new Date(Date.UTC(y,mm-1,dd));
 return d.getUTCFullYear()===y&&d.getUTCMonth()+1===mm&&d.getUTCDate()===dd?
  y+"-"+String(mm).padStart(2,"0")+"-"+String(dd).padStart(2,"0"):null;
}
const day=(iso:string)=>Date.parse(iso+"T12:00:00Z");
function findLegs(grid:unknown[][],ticker:"SPY"|"QQQ"){
 const h=grid.findIndex(r=>value(r?.[0]).toLowerCase()==="ticker"&&value(r?.[1]).toLowerCase()==="strategy");
 if(h<0)throw new Error("Campaign ledger header not found");
 const cols=grid[h].map(x=>value(x).toLowerCase().replace(/[^a-z0-9]/g,""));
 const col=(s:string)=>cols.indexOf(s.replace(/[^a-z0-9]/g,""));
 const ix={ticker:col("ticker"),strategy:col("strategy"),opened:col("opened"),expiry:col("exp"),strike:col("strike"),
  contracts:col("contracts"),credit:col("net premium"),debit:col("net buy to close"),status:col("outcome"),notes:col("notes")};
 if(Object.values(ix).some(x=>x<0))throw new Error("Campaign ledger columns changed");
 const legs:Leg[]=[];const warnings:string[]=[];
 for(let i=h+1;i<grid.length;i++){
  const r=grid[i];
  if(value(r[ix.ticker]).toUpperCase()!==ticker||value(r[ix.strategy]).toUpperCase()!=="CC")continue;
  const state=value(r[ix.status]).toLowerCase();
  if(!["open","opened","active","closed","rolled","assigned","expired","exercised"].includes(state))continue;
  const status=(["opened","active"].includes(state)?"open":state) as LegStatus;
  const opened=date(r[ix.opened]),expiry=date(r[ix.expiry]),strike=money(r[ix.strike]),
   contracts=money(r[ix.contracts]),credit=money(r[ix.credit]),debit=money(r[ix.debit]);
  if(!opened||!expiry||!Number.isFinite(strike)||!Number.isInteger(contracts)||!contracts||
      credit===null||credit<0||(status!=="open"&&debit===null)){
   warnings.push("Row "+(i+1)+" cannot be included in campaign totals; review ledger amounts.");
   continue;
  }
  legs.push({row:i+1,ticker,opened,expiry,strike:strike!,contracts:contracts!,
   netOpening:credit,closeDebit:status==="open"?null:debit, status, notes:value(r[ix.notes])});
 }
 return {legs,warnings};
}
function linked(previous:Leg,next:Leg){
 if(previous.status!=="rolled"||previous.contracts!==next.contracts)return false;
 const gap=day(next.opened)-day(previous.expiry);
 return day(next.opened)>=day(previous.opened) && gap<=7*86400000 && day(next.opened)<=day(previous.expiry)+7*86400000;
}
function campaign(legs:Leg[],account:string){
 const first=legs[0],last=legs[legs.length-1],open=last.status==="open";
 const opening=cents(legs.reduce((a,x)=>a+x.netOpening,0));
 const closing=cents(legs.reduce((a,x)=>a+(x.closeDebit??0),0));
 const realized=cents(legs.reduce((a,x)=>a+(x.status==="open"?0:x.netOpening+(x.closeDebit??0)),0));
 const cashBeforeOutstanding=cents(opening+closing);
 const assignments=legs.filter(x=>["assigned","exercised"].includes(x.status)).map(x=>x.row);
 return {
  account,ticker:first.ticker,active:open,started:first.opened,lastOpened:last.opened,
  latestExpiry:last.expiry,latestStrike:last.strike,contracts:last.contracts,
  sourceRows:legs.map(x=>x.row),rollCount:Math.max(0,legs.length-1),
  grouping:legs.length>1?"INFERRED_ADJACENT_ROLLS":"SINGLE_LEG",
  openingCredits:opening,closeDebits:closing,realizedCompletedLegs:realized,
  openLegCredit:open?last.netOpening:0,
  cashBeforeOutstandingBuyback:cashBeforeOutstanding,
  netRealizedIfCompleted:open?null:cashBeforeOutstanding,
  assignmentRows:assignments,
  description:open?
   "Cash received minus completed buybacks; the open option liability is NOT included.":
   "Realized option-leg net P&L only. Stock returns or assignment economics excluded.",
  legs:legs.map(x=>({row:x.row,opened:x.opened,expiration:x.expiry,strike:x.strike,
   contracts:x.contracts,status:x.status,openingCredit:cents(x.netOpening),
   closingDebit:x.closeDebit===null?null:cents(x.closeDebit),
   realizedPnl:x.status==="open"?null:cents(x.netOpening+x.closeDebit!)})),
 };
}
export function buildCampaigns(grid:unknown[][],ticker:"SPY"|"QQQ",account:string){
 const {legs,warnings}=findLegs(grid,ticker);
 const groups:Leg[][]=[];
 for(const l of legs){
  const current=groups[groups.length-1],prev=current?.at(-1);
  if(prev&&linked(prev,l))current.push(l);
  else groups.push([l]);
 }
 for(let i=0;i<groups.length;i++){
  const last=groups[i].at(-1)!;
  if(last.status==="rolled")warnings.push("Row "+last.row+": rolled outcome has no confirmed successor in this ticker's sequence.");
 }
 const all=groups.map(g=>campaign(g,account));
 const active=all.filter(g=>g.active);
 if(active.length>1)warnings.push("Multiple open campaigns recorded; confirm coverage and roll associations.");
 return {ticker,account,activeCampaigns:active,
  recentCampaigns:all.slice(-6).reverse(),
  totalCampaigns:all.length,
  warnings,
  caveat:"Roll chains use adjacent spreadsheet rows when the previous call says ROLLED, with matching ticker/contracts and plausible dates. Links are inferred, not broker-confirmed."};
}
