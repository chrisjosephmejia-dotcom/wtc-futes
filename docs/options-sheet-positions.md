# WTC Options Seller — read-only positions from Google Sheets

Feature branch targets Netlify site `wtc-options-seller` (base branch `wtc-options-seller`).
No trading automation; the underlying Vertex algorithm and P&L ledger remain unchanged.

## Source of truth

Existing spreadsheet **WTC Options**, with:
- `Traditional IRA` tab: SPY covered calls, header row 2.
- `Audi Wheel` tab: QQQ covered calls, header row 14.
- `Outcome` (column S) is authoritative for open/closed/rolled/assigned status.
- Do NOT use `Buy-to-Close`, fees or `Net Buy-to-Close` to infer closure. The ledger has an OPEN QQQ row with a negative $0.04 fee placeholder.
- A blank/unrecognized outcome is an ambiguous row, not proof of being uncovered.
- An open trade whose expiration is past is a reconciliation warning, never silently discarded.
- The endpoint returns a full-sheet read timestamp, not a guaranteed last-edited timestamp.
- Same-day trades only become visible when the corresponding ledger row is saved.

## Secure one-time Google Cloud setup (must be performed by the account owner)

1. In Google Cloud Console, create or select a project and enable **Google Sheets API**.
2. Create a **service account** for read-only sheet access. If your organization supports short-lived workload identity instead of a JSON key, prefer that; this initial integration uses a service-account signing key.
3. Copy its `client_email` and `private_key` from its key JSON. Do **not** put the JSON/key in this public GitHub repository, an HTML file, chat, or a browser setting.
4. Share the **WTC Options** Google Sheet with that service account's `client_email` as **Viewer only**. Do not set the sheet to "Anyone with the link".
5. In the Netlify project **wtc-options-seller** environment variables, with **Functions** scope, configure:
   - `WTC_OPTIONS_SHEET_ID` = the spreadsheet ID (the segment between `/d/` and `/edit` of the private WTC Options URL).
   - `WTC_GOOGLE_CLIENT_EMAIL` = service account `client_email`.
   - `WTC_GOOGLE_PRIVATE_KEY` = PEM value from `private_key`, keeping newline separators or escaped `\\n`.
   - `WTC_POSITIONS_ACCESS_PASSWORD` = a **new, unique, random password** (at least 16 characters), used only to unlock the read-only position panel.
6. **Review the Netlify combined Lambda environment-variable size limit** before setting a large private key, especially if other API credentials are configured. If it is too large, use a secret manager / short-lived credential flow rather than putting key material in static HTML or a public repository.
7. Only after the environment variables and Sheet Viewer permission are established, merge the feature PR into the `wtc-options-seller` branch to deploy. Redeploy after changing env vars.

## User experience

- Site has SPY and QQQ buttons, retains the original Analyze/Refresh behavior.
- Position panel is locked by default; a server-side password check sets an 8-hour HttpOnly/Secure/SameSite=Strict session cookie. No password or Google credential is sent back.
- `GET /api/positions` reads the spreadsheet on demand and never caches trade data. `POST /api/positions` accepts `{action:"login",password:"..."}` or `{action:"logout"}`.
- UI shows latest recorded opening, source row, contracts, strike, expiry, entry credit and 70% BTC *reference* price (30% of entry credit).
- **It does not pull a live option ask, verify account share coverage, calculate current mark-to-market, or place trades.**
- A missing OPEN row displays "No open call recorded" and explicitly requires broker verification, not "uncovered".
- Spreadsheet remains the only permanent P&L ledger.

## Test plan

1. With credentials configured and feature deployed, log in to position panel.
2. Compare `SPY` against `Traditional IRA` and `QQQ` against `Audi Wheel` exactly.
3. Verify QQQ's OPEN December 1 $657, one-contract call is recognized despite fee-only BTC fields.
4. Verify a CLOSED entry on the same day is not classified as open.
5. Temporarily mark a test row outcome as blank in a **copy** of the sheet: endpoint should require reconciliation, not give permission to sell.
6. Confirm data is unavailable to anonymous GET requests (401), without the login password.
7. Confirm the existing Vertex market signal and quote endpoints still work.

## Safety

This is a *ledger-position viewer*, **not a broker position service**. Never use it as the only safeguard against selling uncovered calls. Same-day activity not yet saved in the ledger cannot appear until recorded. Reconfirm your actual short calls, orders, and share availability in the brokerage before acting.
