# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start local dev server (Cloudflare Worker)
npm run dev

# Deploy worker only
npm run deploy:worker

# Deploy dashboard (Cloudflare Pages)
npm run deploy:dashboard

# Deploy both
npm run deploy

# One-time Google Sheets setup/verification
npm run setup:sheets
```

No lint or test commands are configured.

## Architecture

SMS-based weight tracker: users text a Twilio number → Cloudflare Worker logs to Google Sheets → dashboard reads from Worker API.

**Data flow:**
```
SMS → Twilio webhook → POST /sms (worker/index.js)
                           ↓
                    sheets.js (Google Sheets API)
                           ↓
              Dashboard fetches GET /api/weights or GET /api/log
```

**Worker endpoints** (`worker/index.js`):
- `POST /sms` — Twilio webhook; parses weight or note from SMS body, logs to Sheets, replies with TwiML
- `GET /api/weights` — Returns `{ weights: [...], notes: [...] }` for chart rendering
- `GET /api/log` — Returns last 50 entries newest-first
- `POST /api/entry` — Manual form-based entry (date, time, weight, note fields)

**Google Sheets integration** (`worker/sheets.js`):
- Auth: JWT (RS256) signed with service account key, exchanged for OAuth token via Google's token endpoint — all done with Web Crypto (`SubtleCrypto`), no npm dependencies
- Sheet tab "Weight Log" is auto-created on first entry
- Columns: `Date | Time | Type | Value | Note` (Type is `"weight"` or `"note"`)

**SMS parsing** (`worker/index.js`):
- Numeric message (e.g., "159.3", "159 lbs") → weight entry
- `stats`/`status` → summary SMS reply
- `history`/`log` → last 7 weight entries
- `help`/`?` → command reference
- Any other text → note entry

**Missing file:** `worker/twilio.js` is imported but doesn't exist yet. It should export a `twimlResponse(message)` function that wraps a string in Twilio TwiML XML.

## Required Secrets (via `wrangler secret put`)

- `GOOGLE_SERVICE_ACCOUNT_JSON` — Full service account JSON
- `GOOGLE_SHEET_ID` — Google Spreadsheet ID

## Optional Config (`worker/wrangler.toml` `[vars]` section)

- `TIMEZONE` — Default: `"America/Chicago"`
- `USER_PHONE` — If set, rejects SMS from other numbers

## Stack

- **Runtime:** Cloudflare Workers (no Node.js in prod — use Web APIs only)
- **Frontend:** Vanilla HTML/CSS/JS in `dashboard/index.html` (currently empty)
- **No build step** for worker; Wrangler bundles and deploys `worker/index.js` directly
