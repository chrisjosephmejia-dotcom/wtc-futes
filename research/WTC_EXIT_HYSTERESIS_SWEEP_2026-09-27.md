# WTC Exit Hysteresis Sweep — 2026-09-27

Historical reconstruction using frozen WTC V1 entry logic and the same public continuous NQ 1-minute dataset used by the prior WTC backtests. Entry logic is unchanged. This experiment changes only trade-state exit handling: ordinary WAIT is ignored, an opposite full WTC signal reverses immediately, and positions flatten at CME session close.

For score variants, a long exits when WTC score falls to or below the specified positive threshold; a short exits when score rises to or above the mirrored negative threshold. `_5m` variants additionally require the 5-minute state to flip adverse. `opposite` ignores WAIT/score exits completely and exits only on an opposite full signal or CME session close.

Fee model: 1 MNQ, Robinhood Gold $0.86 per side / $1.72 round trip. Slippage excluded.

| Variant | Trades | Gross P/L | Win rate | Avg gross/trade | Profit factor | Max DD | Median hold | Fees | Net after fees* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Score +4 | 9,402 | $11,054.50 | 30.91% | $1.18 | 1.071 | $2,681.00 | 18 min | $16,171.44 | -$5,116.94 |
| Score +3 | 8,487 | $10,492.50 | 32.41% | $1.24 | 1.068 | $3,270.00 | 21 min | $14,597.64 | -$4,105.14 |
| Score +2 | 6,590 | $16,823.00 | 31.47% | $2.55 | 1.118 | $3,350.50 | 25 min | $11,334.80 | $5,488.20 |
| Score +1 | 5,206 | $16,763.00 | 28.64% | $3.22 | 1.124 | $4,404.50 | 29 min | $8,954.32 | $7,808.68 |
| Score 0 | 4,124 | $19,851.50 | 24.56% | $4.81 | 1.151 | $3,484.50 | 45 min | $7,093.28 | $12,758.22 |
| Score +4 + adverse 5m | 4,842 | $10,297.50 | 33.35% | $2.13 | 1.067 | $6,129.00 | 67 min | $8,328.24 | $1,969.26 |
| Score +3 + adverse 5m | 4,710 | $10,197.50 | 33.65% | $2.17 | 1.067 | $6,359.50 | 68 min | $8,101.20 | $2,096.30 |
| Score +2 + adverse 5m | 4,153 | $15,019.50 | 32.41% | $3.62 | 1.104 | $5,925.50 | 70 min | $7,143.16 | $7,876.34 |
| Score +1 + adverse 5m | 3,744 | $14,603.50 | 29.65% | $3.90 | 1.105 | $5,049.50 | 73 min | $6,439.68 | $8,163.82 |
| Score 0 + adverse 5m | 3,400 | $17,875.00 | 27.97% | $5.26 | 1.132 | $4,152.50 | 82 min | $5,848.00 | $12,027.00 |
| Opposite signal only | 1,599 | $8,452.00 | 32.33% | $5.29 | 1.053 | $10,894.50 | 425 min | $2,750.28 | $5,701.72 |

*Before slippage.

## Gross P/L by year

| Variant | 2023 | 2024 | 2025 |
|---|---:|---:|---:|
| Score +4 | $940.00 | $4,647.50 | $5,467.00 |
| Score +3 | $265.50 | $2,987.50 | $7,239.50 |
| Score +2 | $993.50 | $5,458.50 | $10,371.00 |
| Score +1 | $478.00 | $7,254.00 | $9,031.00 |
| Score 0 | $273.00 | $8,188.00 | $11,390.50 |
| Score +4 + adverse 5m | -$916.50 | $1,454.50 | $9,759.50 |
| Score +3 + adverse 5m | -$998.50 | $1,156.50 | $10,039.50 |
| Score +2 + adverse 5m | $277.00 | $2,587.00 | $12,155.50 |
| Score +1 + adverse 5m | -$323.50 | $4,037.00 | $10,890.00 |
| Score 0 + adverse 5m | -$394.00 | $6,189.00 | $12,080.00 |
| Opposite signal only | $329.50 | -$3,347.00 | $11,469.50 |

## Readout

- The strongest tested stateful exit on this sample was the mirrored **score-0 exit**: enter using unchanged WTC V1 rules, then hold through WAIT until a long score reaches 0 or below / a short score reaches 0 or above, while still reversing immediately on an opposite full signal.
- Score 0 produced the highest gross P/L ($19,851.50), highest profit factor (1.151), and highest modeled net after Robinhood fees ($12,758.22) among the tested variants, before slippage.
- Adding the adverse 5-minute confirmation reduced trades further but did not improve the score-0 economics or drawdown on this historical sample.
- Results remain weakest in 2023 and materially stronger in 2024–2025, so this should be treated as a candidate shadow rule rather than proof of a durable edge.
- Live WTC V1 was not changed by this experiment; the 100-trade forward baseline remains intact.
