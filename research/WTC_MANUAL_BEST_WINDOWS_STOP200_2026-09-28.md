# WTC V2 Manual Follow-Along — Best Two Entry Windows + $200 Stop

Date: 2026-09-28

Research only. No production V2 strategy change.

## Manual follow-along rules tested

- Source strategy: current WTC V2 score-zero hysteresis baseline.
- Only take **fresh V2 entries** whose entry timestamp falls in either:
  - **5:00 PM–11:00 PM CT** (`17:00 <= entry < 23:00`)
  - **8:00 AM–11:00 AM CT** (`08:00 <= entry < 11:00`)
- Once entered, otherwise follow the normal V2 exit even if the exit occurs outside the entry window.
- Add a personal **$200 hard stop** on 1 MNQ = 100 NQ points adverse from entry.
- Stop evaluated from subsequent 1-minute OHLC. If a bar opens through the stop, fill at the worse opening price; the entry bar itself cannot stop because the modeled entry is at that bar close.
- If manually stopped, remain flat until the **next distinct V2 baseline trade**; do not re-enter merely because the same underlying V2 trade remains active.
- Robinhood Gold modeled at **$1.72 round trip**. Slippage excluded except gap-through-stop handling.

## Combined best-two-window results

| Metric | Same windows, no stop | Same windows + $200 stop | Delta from stop |
|---|---:|---:|---:|
| Trades | 2,070 | 2,070 | 0 |
| Wins | 538 | 537 | -1 |
| Losses | 1,526 | 1,527 | +1 |
| Win rate | 25.99% | 25.94% | -0.05 pp |
| Gross P&L | $16,429.00 | $16,241.50 | -$187.50 |
| Modeled RH fees | $3,560.40 | $3,560.40 | $0 |
| Net after fees before slippage | $12,868.60 | $12,681.10 | -$187.50 |
| Average gross trade | $7.94 | $7.85 | -$0.09 |
| Profit factor | 1.250 | 1.247 | -0.003 |
| Max closed-trade drawdown | $4,461.50 | $4,713.50 | +$252.00 |
| Max losing streak | 21 | 21 | 0 |
| Median duration | 39.0 min | 38.5 min | -0.5 min |
| Hard-stop hits | 0 | 20 | +20 |

## Results by entry window with $200 stop

| Entry window CT | Trades | Win rate | Gross P&L | Net after fees | Profit factor | Max closed-trade DD | Stop hits |
|---|---:|---:|---:|---:|---:|---:|---:|
| 5 PM–11 PM | 1,141 | 27.61% | $8,008.50 | $6,045.98 | 1.411 | $2,036.50 | 4 |
| 8 AM–11 AM | 929 | 23.90% | $8,233.00 | $6,635.12 | 1.178 | $4,218.50 | 16 |

## By year with $200 stop

| Year | Trades | Win rate | Gross P&L | Net after fees | Profit factor | Max closed-trade DD | Stop hits |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2023 | 599 | 24.21% | $1,719.00 | $688.72 | 1.114 | $1,906.00 | 0 |
| 2024 | 721 | 24.69% | $5,860.00 | $4,619.88 | 1.264 | $2,681.50 | 5 |
| 2025 | 750 | 28.53% | $8,662.50 | $7,372.50 | 1.303 | $3,090.00 | 15 |

## Context

The full V2 score-zero baseline contained 4,124 trades and generated $19,851.50 gross. At the modeled $1.72 Robinhood round-trip fee, that baseline is $12,758.22 net before slippage.

The selected-window + $200-stop manual-follow variant generated $12,681.10 net before slippage on only 2,070 trades. This is **in-sample research**: the two windows were selected because they were the strongest windows in this same historical dataset. That makes the result vulnerable to selection bias and it should not be treated as an independently validated improvement over full V2.

The $200 stop itself had little effect on the selected-window economics: it triggered 20 times and reduced net P&L by $187.50. It did not improve closed-trade drawdown in this selected sample; max drawdown increased by $252.00.
