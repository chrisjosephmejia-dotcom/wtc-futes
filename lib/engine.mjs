// Pure deterministic read-only signal engines. All histories must be complete and verified.
export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period || values.some(v => !Number.isFinite(v))) return null;
  let x = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) x += alpha * (values[i] - x);
  return x;
}
export function hybrid(qqqCloses, kingMode) {
  const fast = ema(qqqCloses, 80), slow = ema(qqqCloses, 270);
  if (fast === null || slow === null || !['BULLISH','BEARISH'].includes(kingMode))
    return {verified:false, reason:'Missing full historical QQQ series or confirmed King state'};
  const emaRegime = fast > slow ? 'BULLISH' : 'BEARISH';
  return {verified:true,ema80:+fast.toFixed(4),ema270:+slow.toFixed(4),emaRegime,
    kingRegime:kingMode,target:emaRegime === 'BEARISH' ? 'CASH' : kingMode === 'BULLISH' ? 'TQQQ' : 'QQQ'};
}
// Uses confirmed weekly close dates. Must be seeded from official 2026-08-07 King anchor,
// not from an arbitrary first candle. Enforces close-based confirmation only.
export function kingWeekly(weeklyCloses,{mode='BULLISH',bullHigh=723.03,bearLow=null,startDate='2026-08-07'}={}) {
  const switches=[];
  for(const {date,close} of weeklyCloses) {
    if(date <= startDate) continue;
    if(!Number.isFinite(close)) throw Error('Invalid weekly close');
    if(mode === 'BULLISH') {
      bullHigh=Math.max(bullHigh,close);
      if(close <= bullHigh*.96){mode='BEARISH';bearLow=close;switches.push({date,mode,close})}
    } else {
      bearLow=Math.min(bearLow??close,close);
      if(close >= bearLow*1.04){mode='BULLISH';bullHigh=close;switches.push({date,mode,close})}
    }
  }
  return {mode,bullHigh,bearLow,switches};
}
export function centurionDaily(factors,{initialMode='OFF',initialSmoothed=null,cooldown=0,held=0,ordinaryExits=0}={}) {
  let mode=initialMode,smooth=initialSmoothed,lowCount=ordinaryExits;const history=[];
  for(const x of factors) {
    if(!['ON','OFF'].includes(mode) || ['credit','volatility','breadth','trend','utilities'].some(k=>typeof x[k]!=='boolean'))
      throw Error('Unverified Centurion factor');
    const score=((+x.credit)+(+x.volatility)+(+x.breadth)+(+x.trend)+(x.utilities?2:0))/6;
    smooth=smooth===null?score:smooth+(2/6)*(score-smooth);
    const emergency=!x.credit&&!x.volatility;
    if(mode==='ON') {
      held++;
      lowCount=smooth<=.5?lowCount+1:0;
      if(emergency||(lowCount>=2&&held>=3)){mode='OFF';cooldown=5;held=0;lowCount=0}
    }else{
      if(cooldown>0) cooldown--;
      else if(smooth>=.75){mode='ON';held=0;lowCount=0}
    }
    history.push({date:x.date,rawScore:+score.toFixed(6),smoothedScore:+smooth.toFixed(6),
      mode,target:mode==='ON'?'QLD':'TREASURY_BILL_ETF',emergency,cooldown,held});
  }
  return history;
}
