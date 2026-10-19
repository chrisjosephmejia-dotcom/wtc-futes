// Verified read-only Nasdaq Hybrid signal, guarded by source checks.
// Centurion remains pending until parity with the frozen historical checkpoint.
// No user accounts, authentication tokens, or order endpoints are exposed.
import audit from "./model-audit.mjs";
const headers={
  "content-type":"application/json; charset=utf-8",
  "x-content-type-options":"nosniff",
  "cache-control":"public, max-age=60",
  "Netlify-CDN-Cache-Control":"public, s-maxage=900, stale-while-revalidate=1800"
};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export default async function handler(req){
 if(req.method!=="GET")return respond({error:"method_not_allowed"},405);
 try {
  const response=await audit(new Request("https://strategy-signals.internal/api/model-audit"));
  if(!response.ok)throw Error("research_api_unavailable");
  const report=await response.json(),h=report.hybrid,s=report.sources?.QQQ;
  const current=report.status==="research_ready" &&
   report.readyForLiveSignals===false &&
   Number(report.observationCount)>=1400 &&
   report.asOf===report.lastCompletedSession &&
   h?.status==="candidate_complete" && h.asOf===report.asOf &&
   h.kingAnchorMatched===true && h.closeCrosscheck20261016===true &&
   s?.last120Missing===0 && s?.start<="2020-01-15" && s?.end===report.asOf &&
   Number.isFinite(h.ema80)&&Number.isFinite(h.ema270)&&
   ["BULLISH","BEARISH"].includes(h.kingRegime) &&
   ["TQQQ","QQQ","CASH"].includes(h.provisionalTarget);
  const kingWeekComplete=h?.kingLastCompletedWeek && h.kingLastCompletedWeek<=report.asOf;
  const verified=!!(current&&kingWeekComplete);
  const cent=report.centurion;
  const centurionParity=cent?.manualSep1ParityPassed===true;
  return respond({
   verified,
   status:verified?"hybrid_active_centurion_review":"research_validation_pending",
   asOf:report.asOf??null,readOnly:true,
   primaryDataSource:"Yahoo Finance historical daily closes",
   secondaryCrosscheck:"2026-08-07 King anchor and 2026-10-16 Robinhood regular-session quote",
   dataCoverage:{start:s?.start??null,end:s?.end??null,sessions:report.observationCount??null},
   hybrid:verified?{
    verified:true,asOf:h.asOf,
    emaRegime:h.emaRegime,ema80:h.ema80,ema270:h.ema270,
    kingRegime:h.kingRegime,kingLastCompletedWeek:h.kingLastCompletedWeek,
    target:h.provisionalTarget,
    qqqClose:h.qqqClose,kingSwitches:h.kingSwitches.slice(-3),
    execution:"Next regular session after confirmed close"
   }:{verified:false,reason:"Historical checks or King session confirmation incomplete"},
   centurion:{
    verified:false,
    reason:centurionParity?"Full implementation and factor-source reconciliation pending":
      "September 1 reference checkpoint differs from historical reconstruction",
    manualSeptemberScore:0.815,
    reconstructedSeptemberScore:cent?.sep1ManualCheck?.smoothedScore??null,
    provisionalMode:cent?.provisionalRegime??null,
    provisionalTarget:cent?.provisionalTarget??null,
    latestSmoothedScore:cent?.smoothedScore??null,
    asOf:cent?.asOf??null
   },
   warning:"Research-only public signals, not trade execution. Provider data corrections may revise historical values."
  });
 } catch {
  return respond({
   verified:false,status:"source_temporarily_unavailable",asOf:null,readOnly:true,
   hybrid:{verified:false,reason:"Daily historical data could not be validated"},
   centurion:{verified:false,reason:"Manual score reconciliation incomplete"}
  },503);
 }
}
export const config={
 path:["/api/signals","/.netlify/functions/signals"],
 rateLimit:{action:"rate_limit",aggregateBy:["ip","domain"],windowSize:60,windowLimit:40}
};
