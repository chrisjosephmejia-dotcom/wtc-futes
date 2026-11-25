import test from "node:test";
import assert from "node:assert/strict";
import { extractOpenCalls } from "../netlify/functions/lib/options-ledger.mts";

const header=["Ticker","Strategy","price","Opened","Exp","Strike","CoP","Contracts","Premium","Fees",
  "net premium","Collateral","Yield on Capital","Buy-to-Close","Fees to Close","Net Buy-to-Close",
  "Net P&L ($)","Adj YoC","Outcome","Notes"];
const row=(ticker:string, status:string, expiry:string, btc:string) =>
  [ticker,"CC","$638.00","11/24/2026",expiry,"$657.00","80.00%","1","$4.24","-$0.04",
   "$423.96","$63,800.00","0.66%",btc,"-$0.04","-$0.04","$423.92","0.66%",status,""];

test("OPEN row with fee-only BTC is still open and has correct 70% target",()=>{
  const result=extractOpenCalls([header,row("QQQ","open","12/1/2026","$0.00")],"QQQ","Audi Wheel","2026-11-24");
  assert.equal(result.safetyState,"OPEN_RECORDED");
  assert.equal(result.openCalls.length,1);
  assert.equal(result.openCalls[0].takeProfitBuybackPrice,1.27);
  assert.equal(result.openCalls[0].sourceRow,2);
  assert.equal(result.contractsOpen,1);
});
test("CLOSED and ROLLED rows are not treated as open",()=>{
  const result=extractOpenCalls([header,row("QQQ","closed","12/1/2026","-$40.04"),
    row("QQQ","rolled","12/1/2026","-$40.04")],"QQQ","Audi Wheel","2026-11-24");
  assert.equal(result.safetyState,"NO_OPEN_RECORDED");
  assert.equal(result.openCalls.length,0);
  assert.equal(result.needsManualConfirmation,true);
});
test("blank outcome must not be treated as confirmed flat",()=>{
  const result=extractOpenCalls([header,row("SPY","","11/30/2026","$0.00")],"SPY","Traditional IRA","2026-11-24");
  assert.equal(result.safetyState,"RECONCILE");
  assert.equal(result.openCalls.length,0);
  assert.equal(result.warnings.length,1);
});
test("expired but still OPEN row requires broker reconciliation",()=>{
  const result=extractOpenCalls([header,row("QQQ","open","11/20/2026","-$0.04")],"QQQ","Audi Wheel","2026-11-24");
  assert.equal(result.safetyState,"RECONCILE");
  assert.equal(result.openCalls[0].staleExpiration,true);
});
test("a different ticker does not affect the selected account",()=>{
  const result=extractOpenCalls([header,row("QQQ","open","12/1/2026","-$0.04")],"SPY","Traditional IRA","2026-11-24");
  assert.equal(result.matchingRows,0);
  assert.equal(result.openCalls.length,0);
});
test("missing or changed schema raises an error rather than guessing",()=>{
  assert.throws(()=>extractOpenCalls([["Symbol","Strategy"]],"SPY","Traditional IRA","2026-11-24"));
});
