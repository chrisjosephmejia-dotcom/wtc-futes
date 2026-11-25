/**
 * NYSE regular equity trading sessions. Dates and early closes for 2026–2028
 * are sourced from the NYSE's published Hours & Calendars.
 * https://www.nyse.com/trade/hours-calendars
 *
 * Full session: 390 minutes (8:30 AM–3 PM CT).
 * Early close: 210 minutes (8:30 AM–noon CT).
 * This is a realized-volatility time proxy, not option-specific actual market hours.
 */
export const CASH_MINUTES_PER_SESSION=390;
const closed=new Set([
  // 2026: NYSE official exchange closures.
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  // 2027.
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
  // 2028: Jan 1 falls on Saturday; NYSE does not observe a separate closure.
  "2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19",
  "2028-07-04","2028-09-04","2028-11-23","2028-12-25",
]);
const early=new Set([
  "2026-11-27","2026-12-24","2027-11-26","2028-07-03","2028-11-24",
]);
export function nyseCashSessionMinutes(dateISO:string):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateISO))return 0;
  const d=new Date(dateISO+"T12:00:00Z");
  if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==dateISO)return 0;
  const wd=d.getUTCDay();
  if(wd===0||wd===6||closed.has(dateISO))return 0;
  return early.has(dateISO)?210:CASH_MINUTES_PER_SESSION;
}
export function nyseSessionEquivalentsUntil(from:string,to:string):number {
  const start=new Date(from+"T12:00:00Z"),end=new Date(to+"T12:00:00Z");
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return 0;
  let minutes=0;
  for(const d=new Date(start.getTime()+86400000);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    minutes+=nyseCashSessionMinutes(d.toISOString().slice(0,10));
  }
  return minutes/CASH_MINUTES_PER_SESSION;
}
/** CT minutes since midnight. Never counts holidays or after-close minutes. */
export function nyseTodayRemainingFraction(dateISO:string,clockMinutesCT:number):number {
  const total=nyseCashSessionMinutes(dateISO);
  if(!total||!Number.isFinite(clockMinutesCT))return 0;
  return Math.max(0,Math.min(total,(510+total)-Math.max(510,clockMinutesCT)))/CASH_MINUTES_PER_SESSION;
}
