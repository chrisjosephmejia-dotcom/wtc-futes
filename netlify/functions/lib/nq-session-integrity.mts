const TZ = "America/Chicago";
const localFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localParts(ms: number) {
  const parts: Record<string, string> = {};
  for (const p of localFmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour), minute: Number(parts.minute),
  };
}
function addCalendarDay(date: string) {
  const [y,m,d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y,m-1,d+1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}-${String(next.getUTCDate()).padStart(2,"0")}`;
}
function sessionKey(ms: number) {
  const p = localParts(ms);
  return p.hour >= 17 ? addCalendarDay(p.date) : p.date;
}

export type MinuteTime = { t: number };
export function currentNqSessionCoverage(bars: MinuteTime[], nowMs = Date.now()) {
  const currentKey = sessionKey(nowMs);
  const matching = bars.filter(b => Number.isFinite(b?.t) && sessionKey(b.t * 1000) === currentKey)
    .sort((a,b)=>a.t-b.t);
  if (!matching.length) return { complete: false, bars: 0, firstBar: null, lastBar: null, maxGapSec: null, reason: "NO_CURRENT_SESSION_BARS" };
  const first = matching[0];
  const firstLocal = localParts(first.t * 1000);
  let maxGapSec = 0;
  for (let i=1;i<matching.length;i++) {
    maxGapSec = Math.max(maxGapSec, matching[i].t - matching[i-1].t);
  }
  // NQ should trade within the first three minutes of the 17:00 CT reopen.
  // A missing session opener invalidates session VWAP/opening range.
  const hasSessionOpen = firstLocal.hour === 17 && firstLocal.minute <= 2;
  const complete = hasSessionOpen && maxGapSec <= 180;
  return {
    complete,
    bars: matching.length,
    firstBar: new Date(first.t * 1000).toISOString(),
    lastBar: new Date(matching.at(-1)!.t * 1000).toISOString(),
    maxGapSec,
    reason: !hasSessionOpen ? "MISSING_SESSION_OPEN" : maxGapSec > 180 ? "INTRADAY_GAP" : "CONTIGUOUS",
  };
}
