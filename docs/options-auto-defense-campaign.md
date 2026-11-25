# WTC Options Seller — automatic position state and campaign accounting

## State rules

The private Sheets panel is the only source of recorded open SPY and QQQ covered calls.
The strategy is **selective** covered-call selling; there is **no continuous rolling** and no automated order placement.

The separate **Automatic position state** panel combines the saved trade row(s), rolling history and timestamp-verified market price. The four working states are:

- **UNCOVERED**: no OPEN call in ledger. This is never evidence of live brokerage coverage; confirm Robinhood before selling.
- **NORMAL**: one open call, no active linked rolling campaign, underlying more than **0.5% below short strike**, fresh market-session quote.
- **STRIKE WATCH**: same as NORMAL but underlying is within **0.5% below** strike.
- **DEFENSE**: underlying **at/above strike**, or the open call belongs to an active rolling campaign (even after price goes OTM).
- **DATA CHECK / RECONCILE**: spreadsheet not authenticated/old, questionable roll chain or status, multiple openings, or non-current underlying price. No trade instructions.

Defense mode means *analyze*, not *roll now*. Strike breach does not automatically trigger a defensive transaction. Existing Vertex timing signals are unchanged.

## Freshness safeguards

Market prices come from the existing Tastytrade equity quote or the one-minute candle result; timestamps must be available and no more than **5 minutes old during the regular U.S. session**. If only older price is available, the panel shows it as stale and withholds strike-based NORMAL/WATCH/DEFENSE conclusions (existing linked rolling campaigns still display DEFENSE as a ledger fact). No change in the regular event/timing model.

Sheet reads are on-demand and become stale for classification after 5 minutes. The last read is a successful fetch time, **not the timestamp of the latest actual broker fill**.

## Campaign P&L

For each ticker/account, group consecutive call rows only when the previous row outcome is **ROLLED**, the next row has the same number of contracts, and the dates are plausible. A **CLOSED** row always terminates the campaign, even if another call is sold that day. Grouping is **inferred** from the ledger and is not a verified unique broker roll/order ID.

For each group:
- Total net opening premiums = sum of `net premium` (column K).
- Completed BTC amounts = sum of `Net Buy-to-Close` (column P) for completed rows **only**.
- If the last leg is closed: realized option P&L = opening premiums plus completed BTC amounts.
- If the last leg is still open: completed-leg realized P&L is shown separately; the credit collected on the current OPEN leg is **not realized P&L**. Cash before current option buyback = all opening credits plus completed buyback amounts. It is **not** a net profit figure because the current option liability is absent.
- An OPEN row's fee placeholder (e.g., -$0.04) is not a buyback.
- Stock gains/losses and assignment consequences are excluded; explicitly marked in display.

Historical roll links are inferred and labeled accordingly. Current option ask, executable 70% BTC profit, delta/COP, and roll credits remain **out of scope** until we have validated option-chain quotes.

## Operations and testing

This extension is read-only: no updates to Google Sheets or trading accounts. Existing SPY/QQQ selector and authenticated `/api/positions` endpoint are reused. The Netlify function now includes read-only `campaigns` in its authenticated response.

Tests are in `tests/options-campaigns.test.mts`, including the real November SPY roll segment and a synthetic OPEN fee-placeholder edge case. See CI workflow `.github/workflows/options-ledger-checks.yml`.

Manual smoke test after deployment: unlock private panel, switch SPY/QQQ, refresh both Sheets and Analyze/Refresh, confirm both accounts currently show no open calls; expand history and verify the 11/10–11/19 SPY series nets $2,658.72 of option-leg P&L. To test active modes, use local fixtures or the parser tests; do not create a real trade merely to test the UI.
