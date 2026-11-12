// DXLink's default futures trade-candle aggregation stopped producing fresh
// /NQZ6 1m candles on 2026-11-11 after 17:20 CT, despite an active tape.
// Explicit dt=all returned current 1m OHLCV with actual traded volume.
// Do not apply dt=all to 1d: the daily reference regime retains its prior
// calculation until separately researched and backtested.
export function nqCandleSymbol(streamerSymbol: string, period: number, unit: "m" | "d") {
  if (!streamerSymbol || !Number.isInteger(period) || period <= 0) {
    throw new Error("Invalid DXLink candle subscription");
  }
  const dataType = unit === "m" ? ",dt=all" : "";
  return `${streamerSymbol}{=${period}${unit}${dataType}}`;
}
