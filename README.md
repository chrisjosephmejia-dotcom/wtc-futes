# WTC Futes

MNQ futures alignment dashboard for Wheelhouse Trading Co.

- Netlify project: `wtc-futes`
- Production URL: https://wtc-futes.netlify.app/
- QQQ proxy signal engine runs server-side on Netlify Functions.
- Web Push is handled from the server using VAPID keys stored as Netlify environment variables.
- BUY/SELL signal changes can also send transactional email alerts through Resend.
- Stale market data, blocked time windows, timeframe conflict, or excess VWAP extension force `WAIT`.

## Netlify

Publish directory: `public`
Functions directory: `netlify/functions`

Required environment variables:

- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `RESEND_API_KEY`
- `ALERT_EMAIL_TO`

The existing Netlify site ID is `8e525588-b977-4c0b-8f61-f4374eaa8e71`.

Deployment refresh marker: 2026-09-26.
