# WTC XSP 0DTE — V1 Forward-Test Specification

Status: FROZEN BASELINE FOR FORWARD TESTING
Created: 2026-10-05
Branch: wtc-0dte

## Mission

Generate rules-based directional XSP 0DTE CALL / WAIT / PUT signals using tastytrade market data, select and mark an actual same-day XSP option contract, manage the modeled position statefully, and retain a permanent forward-test ledger for later rule analysis.

This system is decision support only. It uses read-only tastytrade credentials and never places an order.

## Instrument model

- Directional signal source: SPY intraday structure.
- Cross-market confirmation: ES futures, QQQ, IWM and VIX from tastytrade. SPY remains the primary entry engine; ES is capped confirmation, not the driver.
- Modeled trade instrument: XSP same-day-expiration equity option.
- One modeled contract per signal.
- CALL = long XSP call.
- PUT = long XSP put.
- No averaging down and no simultaneous positions.
- Entry model fill = tastytrade ask.
- Exit model fill = tastytrade bid.
- Mid-price P&L may also be logged for research, but conservative ask-to-bid P&L is the primary displayed result.

## Entry window

All times America/Chicago.

- 8:30–8:34 CT: NO NEW TRADES. Opening-price discovery only.
- 8:35–10:30 CT: new entries permitted.
- After 10:30 CT: NO NEW TRADES.
- Existing positions may remain open after 10:30 CT until an exit condition is reached.
- Force flat by 2:45 CT.
- Five-minute cooldown after a closed trade before a new entry.
- Maximum three modeled entries per session.

## Data-quality hard gates

No entry when any is true:

- SPY candle history is stale or unavailable.
- XSP same-day option chain cannot be resolved.
- Selected option has no valid bid/ask.
- Option spread is wider than max($0.15, 15% of mid).
- Tracked high-impact event is inside the event lockout window.
- SPY has crossed VWAP four or more times in the most recent 20 minutes (chop gate).
- Market is outside the allowed new-entry window.
- A modeled position is already open.
- Daily max entry count or cooldown has been reached.

## Market structure

### Core directional factors

Signed master score: positive favors CALL, negative favors PUT.

1. SPY vs session VWAP
   - above: +2
   - below: -2

2. VWAP slope over recent bars
   - rising materially: +1
   - falling materially: -1

3. 5-minute EMA structure
   - EMA 8 > EMA 21: +2
   - EMA 8 < EMA 21: -2

4. 15-minute EMA structure
   - EMA 8 > EMA 21: +2
   - EMA 8 < EMA 21: -2

5. Opening-range structure
   - sustained above first 15-minute high: +2
   - sustained below first 15-minute low: -2

6. 5-minute RSI momentum
   - 55–75: +1
   - 25–45: -1
   - extreme RSI does not independently create an entry.

7. QQQ confirmation from its regular-session open
   - positive: +1
   - negative: -1

8. IWM confirmation from its regular-session open
   - positive: +1
   - negative: -1

9. VIX confirmation from its regular-session open
   - falling: +1 to CALL side
   - rising: -1 / PUT support

10. ES futures confirmation (maximum ±2 total)
   - above ES 8:30 CT RTH VWAP: +1
   - below ES 8:30 CT RTH VWAP: -1
   - bullish ES 5-minute EMA structure: +1
   - bearish ES 5-minute EMA structure: -1
   - overnight high/low/mid context is logged and displayed, but does not independently trigger a trade.

## Entry trigger layer

A strong directional score alone is not enough. At least one trigger must confirm so the system does not simply chase extension.

### CALL trigger families

- Opening-range breakout and successful hold/retest.
- VWAP reclaim while 5-minute trend is bullish.
- Trend pullback followed by renewed 1-minute momentum while price remains above VWAP.

### PUT trigger families

Mirror image of CALL:

- Opening-range breakdown and failed retest.
- VWAP rejection while 5-minute trend is bearish.
- Trend bounce followed by renewed 1-minute downside momentum while price remains below VWAP.

## Overextension filter

Do not initiate directly into an exhausted move.

- If SPY is unusually far from VWAP relative to daily ATR, require a pullback/retest trigger before entry.
- Extreme 5-minute RSI is an anti-chase warning, not an automatic reversal signal.

## Signal states

- BUY XSP CALL
- CALL SETUP — WAIT FOR TRIGGER
- WAIT — NO EDGE
- PUT SETUP — WAIT FOR TRIGGER
- BUY XSP PUT
- HOLD CALL
- HOLD PUT
- EXIT CALL
- EXIT PUT
- NO NEW ENTRIES — TIME WINDOW
- WAIT — EVENT RISK
- WAIT — CHOP
- WAIT — OPTION LIQUIDITY
- MARKET CLOSED

Initial entry threshold:
- CALL requires master score >= +7 plus a valid bullish trigger.
- PUT requires master score <= -7 plus a valid bearish trigger.

## XSP contract selection

- Resolve the actual same-day XSP expiration from tastytrade.
- Use the exact XSP index quote for strike selection when available.
- Prefer the closest slightly-in-the-money contract:
  - CALL: closest strike at or just below XSP.
  - PUT: closest strike at or just above XSP.
- If several contracts are comparably close, prefer the tighter percentage spread.
- Reject the modeled entry if liquidity fails the spread gate.
- Store OCC symbol, strike, option type, expiration, bid, ask and mid at entry.

Future enhancement:
- Add live DXLink Greeks and compare ATM / ~0.55 delta selection after sufficient forward data. Do not change V1 contract selection before the baseline sample unless there is an implementation bug.

## Stateful exit management

V1 deliberately does NOT take profit at a fixed percentage. We want to observe the natural MFE/MAE distribution before optimizing profit-taking.

### Normal thesis exit

CALL:
- do not exit on ordinary positive-score weakening.
- exit when the master score reaches <= 0 for two consecutive completed 1-minute evaluations.

PUT:
- do not exit on ordinary negative-score weakening.
- exit when the master score reaches >= 0 for two consecutive completed 1-minute evaluations.

This is the 0DTE version of WTC Futes hysteresis: a temporary WAIT does not automatically kill the position.

### Immediate invalidation

Exit without waiting for the two-bar neutral confirmation when:
- a full opposite-direction entry condition appears, or
- price loses/reclaims VWAP against the position AND the 5-minute trend flips against the position.

### Emergency option-price backstop

- Exit modeled position if conservative ask-to-bid P&L reaches -75%.
- This is a catastrophe backstop, not the primary exit logic.
- Never widen the backstop and never average down.

### Event exit

- Force exit five minutes before a tracked high-impact scheduled event if a position remains open.
- No re-entry after 10:30 CT.

### Time exit

- Force exit by 2:45 CT.
- No position is carried into expiration settlement.

## Event risk

High-impact scheduled macro events are hard risk controls, not directional forecasts.

Entry lockout:
- no new trade from 10 minutes before through 15 minutes after a tracked high-impact event.

If an event occurs after the entry window and a position is open:
- close five minutes before the event.

## Permanent forward-test logging

### Closed-trade ledger

Persist forever in Netlify Blobs.

Each trade records:

- trade number / unique id
- date
- CALL or PUT
- entry setup family
- exact XSP OCC contract
- strike / expiration / option type
- entry time CT
- exit time CT
- duration
- entry SPY
- exit SPY
- entry XSP index
- exit XSP index
- entry bid / ask / mid
- exit bid / ask / mid
- primary conservative P&L: entry ask -> exit bid
- mid-to-mid research P&L
- P&L dollars
- P&L percent
- MFE percent
- MAE percent
- entry master score
- exit master score
- exit reason
- SPY VWAP distance
- opening-range state
- 5m RSI
- 5m trend
- 15m trend
- QQQ from open
- IWM from open
- VIX from open
- event-risk state
- option spread percent

### Raw decision log

Store one snapshot for every regular-session evaluation so later research includes trades we took AND setups we skipped.

Fields include:
- timestamp CT
- raw CALL/WAIT/PUT recommendation
- stateful position state
- master score
- trigger family
- SPY price / VWAP / OR
- 1m / 5m / 15m structure
- RSI
- QQQ / IWM / VIX confirmation
- chop gate
- event gate
- selected XSP contract and quote when eligible

## Website

Top section:
- BUY CALL / WAIT / BUY PUT master state
- entry-window status
- current score and trigger
- tastytrade feed freshness

Open-position card:
- XSP contract
- entry ask
- current bid
- modeled P&L $ and %
- MFE / MAE
- hold duration
- current score
- current exit condition

Market-structure panel:
- SPY / VWAP
- opening range
- 5m and 15m trend
- RSI
- ES RTH VWAP / 5m trend / overnight context
- QQQ confirmation
- IWM confirmation
- VIX confirmation
- chop status
- event status

Scorecard:
- every live score contribution and gate

Performance:
- lifetime conservative P&L
- completed trades
- win rate
- average trade
- profit factor
- maximum closed-trade drawdown
- CALL vs PUT split

Recent trades:
- show approximately 25 latest completed trades on site.

Downloads:
- permanent trade-ledger CSV
- raw decision-log CSV

## Forward-test discipline

- Label production baseline: WTC XSP 0DTE V1.
- Do not tune from a handful of trades.
- First review point: 50 completed trades.
- More important review point: 100 completed trades.
- Preserve the original V1 results when later rules are changed.
- Any V2 should get a new rule/version identifier so results are not mixed.

Primary questions for later analysis:
- Which trigger family has the best expectancy?
- CALL vs PUT asymmetry.
- Time-of-day expectancy.
- Score at entry vs outcome.
- Effect of ES confirmation and whether its ±2 cap is useful.
- Effect of QQQ/IWM/VIX confirmation.
- Effect of VWAP-cross/chop gate.
- Option spread drag.
- MFE/MAE distribution and whether a profit trail would improve results.
- Whether -75% emergency stop is too loose/tight.
- Whether score-zero hysteresis is optimal for 0DTE.
- Whether ATM/slightly-ITM selection should be replaced with a delta-based selector.


Redeploy marker: env refresh
