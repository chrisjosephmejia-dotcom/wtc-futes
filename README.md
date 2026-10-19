# Strategy Signals

A public, read-only website for Nasdaq Hybrid and Nasdaq Centurion. No personal account information or trade execution. Project: https://app.netlify.com/projects/wtc-strategy-signals.

## Deployment
GitHub repository: chrisjosephmejia-dotcom/wtc-futes
Dedicated branch: `wtc-strategy-signals`
**Netlify build settings:** Production branch `wtc-strategy-signals`; base directory blank; build command blank; publish directory `public`; functions directory `netlify/functions`. Netlify auto-builds after the branch is connected. Use this branch for Strategy Signals only; do not alter other WTC production branches.

## Secrets: do not enter until branch is deployed
Set `TASTY_CLIENT_SECRET` and `TASTY_REFRESH_TOKEN` through Netlify project Environment variables, mark as secret, Functions scope and production context. Never store the values in Git, frontend, screenshots, or chat. Use personal read-only tastytrade grant. Changes require redeployment.
Then visit `/.netlify/functions/provider-check` for sanitized connection status.

## Frozen strategy definitions
Hybrid: Daily QQQ EMA80 > EMA270 allows weekly King; King bullish TQQQ / bearish QQQ; otherwise cash. King weekly close must reverse >=4% from tracked bullish high/bearish low. King anchor 2026-08-07, bullish QQQ 723.03. Complete sessions; next regular session execution.
Centurion: adjusted HYG/LQD ROC20 positive (1); VIX<VIX3M (1); adjusted QQEW/QQQ above EMA100 (1); adjusted QQQ above EMA150 (1); adjusted XLU/SPY below EMA50 (2). Score points / 6, EMA5 smoothed. Enter on >=75%; ordinary exit on <=50% two sessions after minimum 3-session hold; emergency credit+volatility both fail; 5-session cooldown; QLD vs designated Treasury-bill ETF.

## Readiness
- Deployed website and provider health endpoint require no real credentials to build.
- **Signal history ingestion, DXLink candle backfill, adjusted factor treatment, and state-sequence replay remain incomplete and unverified.**
- Signal endpoint intentionally returns verified:false rather than fake live recommendations.
- Formula tests: `node --test tests/engine.test.mjs`.
- OAuth endpoint: https://developer.tastytrade.com/oauth/
- DXLink streaming docs: https://developer.tastytrade.com/docs/concepts/streaming/
