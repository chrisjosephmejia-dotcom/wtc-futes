# WTC MCL Futures V1 — Shadow research

Netlify site reused: ticker-pulse-devstage-test.
Branch: wtc-stock-trader. The old Stock Trader code is recoverable in Git history.

Design/operation cloned from WTC MNQ V4 without modifying the MNQ main branch.
Tastytrade credentials stay in the existing Netlify site's server-side environment.
Independent Micro WTI MCL contract, 1-minute and daily DXLink bars, and separate Netlify Blobs ledger.
Entry: MNQ V4 VWAP, EMA, opening range, timeframes, score thresholds. Parameters are UNVALIDATED for MCL.
Long exit when score <= +1; short exit when score >= -1; reversals and session closes also exit.
No fixed hard stop or take profit in research. This system does NOT execute orders or connect to broker trade APIs.

Scheduled paper engine: once per minute Sun–Fri. It costs Netlify compute even if site is closed.
UI: page data refresh every 15 seconds while open, log refresh every 30 seconds.
Alerts: push and email use separate VAPID/Resend credentials, which may not yet be configured on this Netlify site.
Theoretical P&L: 100 USD per 1.00 USD/bbl move; costs and slippage EXCLUDED.

Endpoints: /api/status /api/live-price /api/signal-log /api/signal-log.csv
/api/decision-log.csv?all=1 /api/tasty-status /api/mcl-signal-test /api/mcl-candles-test
/api/subscription /api/vapid-key /api/test-push /api/test-email /api/email-health.
Research only; assess MCL data entitlements, contract roll handling, EIA events, drawdown and emergency stops before trading.
