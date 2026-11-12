export type NqBarTimestamp = { t: number };
/**
 * A stream snapshot is acceptable for a fresh WTC V4 decision only if it
 * contains an actual time-stamped NQ minute candle from this market session.
 * Never use REST quotes, cached arrival times, or synthesized bars here.
 */
export function isFreshNqCandleSnapshot(bars: NqBarTimestamp[], nowMs: number, maxAgeMs=90_000): boolean {
  const last = bars.at(-1)?.t;
  if (!Number.isFinite(last) || !Number.isFinite(nowMs)) return false;
  const observedTime = Number(last) * 1000;
  return observedTime >= nowMs - maxAgeMs && observedTime <= nowMs + 30_000;
}
