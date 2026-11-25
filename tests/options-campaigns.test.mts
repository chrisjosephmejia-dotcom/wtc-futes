import test from "node:test";
import assert from "node:assert/strict";
import { buildCampaigns } from "../netlify/functions/lib/options-campaigns.mts";

const header=["Ticker","Strategy","price","Opened","Exp","Strike","CoP","Contracts","Premium","Fees",
 "net premium","Collateral","Yield on Capital","Buy-to-Close","Fees to Close","Net Buy-to-Close",
 "Net P&L ($)","Adj YoC","Outcome",""];
function leg(ticker:string,opened:string,exp:string,strike:number,n:number,credit:number,debit:number|string,status:string,note=""){
 const v=Array.from({length:20},()=>"");
 v[0]=ticker;v[1]="CC";v[3]=opened;v[4]=exp;v[5]="$"+strike;v[7]=String(n);
 v[10]="$"+credit;v[15]=String(debit);v[18]=status;v[19]=note;
 return v;
}
test("SPY 11/10-11/19 rolling chain has four legs and a distinct next sale",()=>{
 const grid=[header,
  leg("SPY","11/10/2026","11/13/2026",755,4,847.84,-1944.16,"rolled"),
  leg("SPY","11/11/2026","11/20/2026",760,4,2271.84,-572.16,"rolled"),
  leg("SPY","11/16/2026","11/23/2026",754,4,1459.84,-416.16,"rolled"),
  leg("SPY","11/17/2026","11/24/2026",746,4,1271.84,-260.16,"closed","Closed outright; next is separate"),
  leg("SPY","11/19/2026","11/27/2026",740,4,1219.84,-364.16,"closed")];
 const x=buildCampaigns(grid,"SPY","Traditional IRA");
 assert.equal(x.totalCampaigns,2);
 const c=x.recentRollingCampaigns[0];
 assert.equal(c.rollCount,3);
 assert.deepEqual(c.sourceRows,[2,3,4,5]);
 assert.equal(c.netRealizedIfCompleted,2658.72);
 assert.equal(x.recentCampaigns[0].netRealizedIfCompleted,855.68);
});
test("an OPEN QQQ call's $0.04 fee placeholder is not counted as a buyback",()=>{
 const grid=[header,
  leg("QQQ","11/24/2026","12/1/2026",657,1,423.96,-0.04,"open")];
 const x=buildCampaigns(grid,"QQQ","Audi Wheel");
 const c=x.activeCampaigns[0];
 assert.equal(c.openingCredits,423.96);
 assert.equal(c.closeDebits,0);
 assert.equal(c.realizedCompletedLegs,0);
 assert.equal(c.cashBeforeOutstandingBuyback,423.96);
 assert.equal(c.netRealizedIfCompleted,null);
});
test("an ongoing rollover stays a campaign even when strike later moves OTM",()=>{
 const grid=[header,
  leg("QQQ","11/10/2026","11/17/2026",688,1,341.96,-1035.04,"rolled"),
  leg("QQQ","11/11/2026","11/20/2026",692,1,1105.96,-196.04,"rolled"),
  leg("QQQ","11/16/2026","11/23/2026",690,1,296.96,-91.04,"rolled"),
  leg("QQQ","11/17/2026","11/24/2026",680,1,278.96,-0.04,"open")];
 const x=buildCampaigns(grid,"QQQ","Audi Wheel");
 const c=x.activeCampaigns[0];
 assert.equal(c.rollCount,3);
 assert.equal(c.realizedCompletedLegs,422.76);
 assert.equal(c.cashBeforeOutstandingBuyback,701.72);
 assert.equal(c.latestStrike,680);
});
test("a roll count mismatch prevents grouping and produces a warning",()=>{
 const grid=[header,
  leg("SPY","11/11/2026","11/20/2026",760,4,1000,-2000,"rolled"),
  leg("SPY","11/12/2026","11/27/2026",765,3,1200,-100,"closed")];
 const x=buildCampaigns(grid,"SPY","Traditional IRA");
 assert.equal(x.totalCampaigns,2);
 assert.equal(x.warnings.length,1);
});
test("completed leg missing a buyback must not show fictitious profit",()=>{
 const grid=[header,leg("SPY","11/11/2026","11/20/2026",760,4,1000,"","closed")];
 const x=buildCampaigns(grid,"SPY","Traditional IRA");
 assert.equal(x.totalCampaigns,0);
 assert.equal(x.warnings.length,1);
});
test("next independent leg closes a campaign even if opened on same date",()=>{
 const grid=[header,
  leg("QQQ","11/19/2026","11/27/2026",656,1,293.96,-168.04,"closed"),
  leg("QQQ","11/19/2026","11/27/2026",660,1,310,-90,"open")];
 const x=buildCampaigns(grid,"QQQ","Audi Wheel");
 assert.equal(x.totalCampaigns,2);
 assert.equal(x.activeCampaigns[0].sourceRows[0],3);
});
