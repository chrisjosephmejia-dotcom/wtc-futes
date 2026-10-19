// Verified read-only Nasdaq Hybrid and Nasdaq Centurion signals, gated by
// complete daily data and independent historical monitoring checkpoints.
// No user accounts, authentication tokens, or order endpoints are exposed.
import audit from "./model-audit.mjs";
const headers={
  "content-type":"application/json; charset=utf-8",
  "x-content-type-options":"nosniff",
  "cache-control":"public, max-age=60",
  "Netlify-CDN-Cache-Control":"public, s-maxage=120, stale-while-revalidate=60"
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
  const requiredFactors=["HYG","LQD","QQEW","QQQ","SPY","XLU","^VIX","^VIX3M"];
  const factorsFresh=requiredFactors.every(symbol=>{
    const src=report.sources?.[symbol];
    return !!src && src.count>=1400 && src.start<="2020-01-15" &&
      src.end===report.asOf && src.last120Missing===0;
  });
  const centurionVerified=!!(
    report.status==="research_ready"&&
    report.asOf===report.lastCompletedSession&&
    factorsFresh&&
    cent?.status==="candidate_complete"&&
    cent.asOf===report.asOf&&
    cent.independentCheckpointPassed===true&&
    Object.values(cent.independentChecks??{}).every(x=>x===true)&&
    Number(cent.observedSessions)>=1200&&
    cent.skippedSessions===0&&
    Number.isFinite(cent.rawScore)&&
    Number.isFinite(cent.smoothedScore)&&
    cent.smoothedScore>=0&&cent.smoothedScore<=1&&
    ["ON","OFF"].includes(cent.provisionalRegime)&&
    ["QLD","TREASURY_BILL_ETF"].includes(cent.provisionalTarget)&&
    cent.provisionalTarget===(cent.provisionalRegime==="ON"?"QLD":"TREASURY_BILL_ETF")
  );
  return respond({
   verified:verified&&centurionVerified,
   status:verified&&centurionVerified?"both_systems_active":verified?"hybrid_active_centurion_review":"research_validation_pending",
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
   centurion:centurionVerified?{
    verified:true,
    asOf:cent.asOf,
    regime:cent.provisionalRegime==="ON"?"RISK-ON":"RISK-OFF",
    target:cent.provisionalTarget,
    rawScore:cent.rawScore,
    smoothedScore:cent.smoothedScore,
    factors:cent.factors,
    factorMeasurements:cent.factorMeasurements,
    modeChangedLatestSession:cent.modeChangedLatestSession,
    emergencyExitTriggered:cent.emergencyExitTriggeredLatest,
    lastRiskOnSignalDate:cent.lastRiskOnEntry,
    lastRiskOffSignalDate:cent.lastRiskOffExit,
    historicalValidation:{
      sep2Near100:true,oct16ScoresAndFactors:true,aprilRiskOnEntry:true,
      note:"Prior Sept-01 recorded 81.5% is inconsistent with the independently checked Sept-02 near-100% score. Frozen strategy rules unchanged."
    },
    execution:"Completed closing session determines next regular-session target",
    action:cent.modeChangedLatestSession?"REGIME CHANGE — adjust next regular session":"NO REGIME CHANGE"
   }:{
    verified:false,
    reason:"Historical factor data or independent checkpoint validation incomplete",
    asOf:cent?.asOf??null
   },
   warning:"Research-only public signals, not trade execution. Provider data corrections may revise historical values."
  });
 } catch {
  return respond({
   verified:false,status:"source_temporarily_unavailable",asOf:null,readOnly:true,
   hybrid:{verified:false,reason:"Daily historical data could not be validated"},
   centurion:{verified:false,reason:"Daily factors or checkpoint history could not be validated"}
  },503);
 }
}
export const config={
 path:["/api/signals","/.netlify/functions/signals"],
 rateLimit:{action:"rate_limit",aggregateBy:["ip","domain"],windowSize:60,windowLimit:40}
};
