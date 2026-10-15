# WTC Stock Trader — development rules

1. Broad, unleveraged index ETFs (QQQ, QQQM, SPY, VOO, IVV, SPLG, VTI, ITOT, SCHB) use the staged index accumulation ladder; other tickers retain the original business/thesis gate.
2. Index buy thresholds are dips of 1%, 2%, 3%, 5%, 8%, 12%, 20%, and 30% from the highest high in the most recent 252 daily sessions (the rolling 52-week anchor); incremental capital allocations are 2%, 3%, 5%, 10%, 15%, 20%, 20%, and 25% of a separately reserved dip-buying budget.
3. Purchases are cumulative milestones, not repetitive new orders on every price refresh. Falling through multiple levels implies only the difference between the cumulative target and amounts previously bought.
4. The index engine buys across bullish and bearish regimes; 50/200 EMAs and RSI are informational only. Deep-dip thesis vetoes apply only to individual stocks.
5. The browser tracker is *manual*, per browser/device and ticker. "Mark bought" is an acknowledgment, not a broker fill, and is never sent as a trade. A fresh 52-week high resets the browser tracking cycle. If the rolling anchor drops after an extended bear market, users must verify the cycle manually.
6. Normal recurring index contributions are separate from the dip-buying reserve and ladder.
7. Individual stocks: do not recommend buys merely because they fell. No BUY unless inside a displayed stock zone; strong dips require fresh thesis confirmation.
8. Technical price data should come from Tastytrade wherever possible. Preserve other strategies and production sites.
