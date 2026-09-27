# WTC WAIT Duration Sweep — 2026-09-27

Historical reconstruction using frozen WTC V1 entry logic on the same public continuous NQ 1-minute dataset used for the V1 backtest. Each variant keeps the same entries and only changes how many consecutive WAIT minutes are tolerated before exit. The `opposite` variant ignores WAIT entirely and exits only on an opposite actionable signal or CME session close.

Fee model: Robinhood Gold MNQ at $0.86 per side / $1.72 round trip for 1 MNQ. Slippage is excluded.

| WAIT exit rule | Trades | Gross P/L | Win rate | Avg gross/trade | Profit factor | Max drawdown | Median hold | Fees | Net after fees, before slippage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 minute (V1) | 29,733 | $7,878.50 | 31.51% | $0.26 | 1.047 | $2,179.50 | 2 min | $51,140.76 | -$43,262.26 |
| 3 minutes | 16,143 | $6,301.00 | 36.04% | $0.39 | 1.038 | $3,343.00 | 7 min | $27,765.96 | -$21,464.96 |
| 5 minutes | 12,227 | $7,096.50 | 37.16% | $0.58 | 1.044 | $3,322.50 | 11 min | $21,030.44 | -$13,933.94 |
| 10 minutes | 8,717 | $9,754.00 | 39.15% | $1.12 | 1.061 | $3,559.50 | 20 min | $14,993.24 | -$5,239.24 |
| 15 minutes | 7,338 | $12,024.00 | 39.44% | $1.64 | 1.075 | $3,917.00 | 28 min | $12,621.36 | -$597.36 |
| 30 minutes | 5,069 | $7,968.00 | 39.26% | $1.57 | 1.050 | $4,541.50 | 55 min | $8,718.68 | -$750.68 |
| Opposite signal only | 1,599 | $8,452.00 | 32.33% | $5.29 | 1.053 | $10,894.50 | 425 min | $2,750.28 | $5,701.72 |

## Gross P/L by year

| WAIT exit rule | 2023 | 2024 | 2025 |
|---|---:|---:|---:|
| 1 minute | $737.00 | $5,070.00 | $2,071.50 |
| 3 minutes | $675.00 | $1,726.00 | $3,900.00 |
| 5 minutes | $637.00 | $2,880.00 | $3,579.50 |
| 10 minutes | $1,190.50 | $2,316.50 | $6,247.00 |
| 15 minutes | -$278.00 | $4,600.50 | $7,701.50 |
| 30 minutes | $430.00 | $1,771.00 | $5,767.00 |
| Opposite signal only | $329.50 | -$3,347.00 | $11,469.50 |

## Notes

- The 15-minute WAIT rule produced the highest gross P/L and highest profit factor in this sweep, but remained slightly negative after the $1.72 round-trip fee assumption before slippage.
- Opposite-signal-only was the only tested variant positive after the Robinhood fee assumption, but it had by far the largest drawdown and its result was heavily concentrated in 2025; 2024 was materially negative.
- The 1-minute row reproduces the frozen V1 backtest, confirming the sweep is using the same baseline entry logic.
- These are theoretical 1-minute bar-close fills using continuous public NQ history, not exact tastytrade active-contract tick replays. Quarterly roll behavior can differ, and commissions/fees are modeled separately while slippage is excluded.
- Live WTC V1 was not changed by this sweep.
