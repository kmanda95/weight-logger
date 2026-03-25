# ⚖️ Weight Log — Setup & Deployment Guide

Track your weight over time via SMS. Text a number, get a confirmation. View trends on a clean dashboard.

---

## Architecture

```
You text your Twilio number
        ↓
Twilio sends webhook → Cloudflare Worker (/sms)
        ↓
Worker detects weight vs. note → logs to Google Sheets
   ("Weight Log" tab, auto-created on first use)
        ↓
Worker replies via SMS with change summary
        ↓
Dashboard (Cloudflare Pages) reads from Worker API:
  GET /api/weights  → all weights + notes
  GET /api/log      → 50 most recent entries
```

---

## SMS Usage

| You text | What happens |
|----------|-------------|
| `159.3` | Logs weight as 159.3 lbs |
| `159.3 lbs` | Same |
| `period started` | Logs as a note for today |
| `went on vacation` | Logs as a note for today |
| `didn't count calories yesterday` | Logs as a note |
| `stats` | Summary: latest, 7-day change, all-time |
| `history` | Last 7 weight entries |
| `help` | Command reference |

Any text that isn't a number is treated as a note. Notes appear on the dashboard alongside your weights.

---

## Prerequisites

- [Cloudflare account](https://cloudflare.com) (free tier works)
- [Twilio account](https://twilio.com) (~$1/month for a phone number)
- [Google Cloud account](https://console.cloud.google.com) (free)
- Node.js 18+ installed locally

---

## Step 1 — Google Sheets Setup

### 1a. Create your spreadsheet
1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **"Weight Log"**
3. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**COPY_THIS_PART**/edit`

> **How the tab works:** The Worker automatically creates a tab called "Weight Log" on the first entry. Columns: `Date | Time | Type | Value | Note`. Type is either `weight` or `note`.

### 1b. Create a Service Account
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable the **Google Sheets API**:
   - APIs & Services → Library → search "Google Sheets API" → Enable
4. Create a Service Account:
   - APIs & Services → Credentials → Create Credentials → Service Account
   - Name: `weight-tracker`
   - Role: Editor
5. Generate a key:
   - Click your service account → Keys → Add Key → JSON
   - Download the JSON file — keep this safe!
6. **Share your Google Sheet** with the service account email (e.g. `weight-tracker@YOUR-PROJECT.iam.gserviceaccount.com`) — give it **Editor** access

### 1c. Verify access
```bash
cd sheets-setup
npm install googleapis
GOOGLE_SERVICE_ACCOUNT_JSON='PASTE_JSON_HERE' \
GOOGLE_SHEET_ID='your-sheet-id' \
node setup-sheet.js
```

---

## Step 2 — Twilio Setup

1. Buy a phone number at [twilio.com/console](https://console.twilio.com)
2. Note your **Account SID** and **Auth Token**
3. Configure the webhook after Step 4

---

## Step 3 — Deploy the Cloudflare Worker

### 3a. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 3b. Set secrets
```bash
cd worker

# Your Google service account JSON (entire file contents)
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# Your Google Sheet ID
wrangler secret put GOOGLE_SHEET_ID

# Optional: your phone number — if set, only this number can log entries
# Format: +1XXXXXXXXXX
wrangler secret put USER_PHONE
```

### 3c. (Optional) Set your timezone
Edit `worker/wrangler.toml`:
```toml
[vars]
TIMEZONE = "America/New_York"  # or America/Los_Angeles, Europe/London, etc.
```
See [tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) for valid values.

### 3d. Deploy
```bash
wrangler deploy
```

Note the Worker URL: `https://weight-log.YOUR-SUBDOMAIN.workers.dev`

### 3e. Connect Twilio
1. Twilio Console → Phone Numbers → your number
2. Under Messaging Configuration:
   - Webhook: `https://weight-log.YOUR-SUBDOMAIN.workers.dev/sms`
   - Method: **HTTP POST**
3. Save

### 3f. Test
Text your Twilio number: `159.3`

You should receive:
```
✅ Logged: 159.3 lbs
📅 3/21/2026 at 09:15 AM

Text a note anytime to add context (e.g. "period started", "ate out today")
```

---

## Step 4 — Deploy the Dashboard

### 4a. Update the API URL
Edit `dashboard/index.html` line near the top of the `<script>`:
```javascript
const API_BASE = 'https://weight-log.YOUR-SUBDOMAIN.workers.dev';
```

### 4b. Deploy via Cloudflare Pages

**Option A — GitHub (recommended):**
1. Push to GitHub
2. Cloudflare Dashboard → Pages → Create a project → Connect to Git
3. Select your repo
4. Build settings:
   - Build command: *(leave empty)*
   - Build output directory: `dashboard`
5. Deploy!

**Option B — Direct upload:**
```bash
wrangler pages deploy dashboard --project-name weight-log
```

Your dashboard: `https://weight-log.pages.dev`

---

## Dashboard Features

- **Stats row**: Latest weight, 7-day change, 30-day change, all-time change
- **Chart**: Weight over time with 7-day rolling average, colored markers for notes on hover
- **Range tabs**: 30d / 90d / 6mo / 1yr / All
- **Log table**: All entries, newest first. Weight entries show per-entry change. Notes shown inline with yellow highlight.

---

## Cost Estimate

| Service | Cost |
|---------|------|
| Cloudflare Workers | Free (100k req/day) |
| Cloudflare Pages | Free |
| Twilio number | ~$1.15/month |
| Twilio SMS (US) | ~$0.0079/message |
| Google Sheets API | Free |
| **Total** | **~$1–2/month** |

---

## Troubleshooting

**SMS not received** — Check Twilio's error logs, verify webhook URL is set to `/sms`

**"Could not load data" on dashboard** — Make sure `API_BASE` in `index.html` is set to your Worker URL

**Google Sheets errors** — Confirm the service account email has Editor access to your sheet

**Wrong timezone on entries** — Update `TIMEZONE` in `worker/wrangler.toml` and redeploy
