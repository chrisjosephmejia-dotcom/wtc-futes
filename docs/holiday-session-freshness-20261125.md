# Nov 25, 2026: Position freshness and holiday session fixes

This is a calculation/UX repair only; no trading strategy or Vertex turn trigger changes.

## Sheet read vs quote refresh

Previously, a read-only sheet snapshot older than five minutes rendered as **RECONCILE**, even if no open calls were recorded and there were no inconsistent rows. A stale snapshot is not proof of a position discrepancy.

- **RECONCILE** is now reserved for contradictory or ambiguous ledger data, unpaired rolls, or multiple open campaigns.
- **DATA CHECK** indicates a sheet read older than five minutes, asking the user to refresh it.
- **Analyze / Refresh** refreshes both the market snapshot and Google Sheet so their timestamps stay aligned; **Refresh sheet** remains available separately.
- No row is changed and no broker position is inferred from the absence of an OPEN row.

## Exchange calendar for realized volatility

The previous `sessionsUntil()` counted weekdays only, including Thanksgiving and early-close Fridays as full days. On November 25, 2026, the December 4 expiration was shown as approximately **7.47 trading sessions** around 11:57 a.m. CT.

The new `nyse-sessions.mts` uses the official NYSE 2026–2028 closure and early close calendar (https://www.nyse.com/trade/hours-calendars). The expected figure with 11:57 a.m. CT as the example time is approximately **6.01 full-session equivalents**, reflecting:
- November 26: closed (0 sessions)
- November 27: shortened (210/390 session)
- November 30–December 4: 5 full sessions
- Remaining November 25 regular-session minutes: ~0.47 session

This changes the displayed realized-volatility range proxy, not any actual options implied-volatility quote, option chain COP or trading orders.

The existing auto-Friday expiry selection rule remains unchanged. A trader who wants a specific 7-calendar-day expiration should select an appropriate listed contract manually (Dec 2 for Nov 25, if available). This avoids quietly rewriting trading strategy rules during a data-quality repair.

## Validation

`tests/nyse-sessions.test.mts` covers Thanksgiving, Black Friday early close, and future closures. The existing position and campaign tests continue to run. No changes are made to the Google Sheet, Robinhood account or active strategy signal thresholds.
