# WhatsApp Web Automation Dashboard

Web app to manage WhatsApp Web automation:
- multi-user login (JWT auth)
- workspace role permissions (owner/admin/member)
- create multiple workspaces (auth required)
- run multiple WhatsApp QR sessions at the same time
- start/stop client per workspace
- scan QR from browser page per workspace
- save recipients and automation config per workspace
- send bulk message now (instant / staggered / random delays)
- message template strategies (single / rotate / random)
- run scheduled bulk sends with cron
- automation replies (exact, contains, or multi-rule list)
- booking agent (slot offering, auto-book confirm, reminders, no-show follow-up)
- reports dashboard (summary, recent logs, CSV export)
- Excel/CSV recipient import (append or replace)
- connect timer with wait guidance while WhatsApp starts

## Setup

```bash
npm i
cp .env.example .env
```

Edit `.env` values as needed.

## Auth

- Default bootstrap user on first run:
  - username: `admin`
  - password: `admin12345`
- Override with env:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - `AUTH_SECRET`

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Render Deploy Note (Chrome Required)

Use this exact Render config.

Build Command:

```bash
npm ci && npm run render-build
```

Start Command:

```bash
npm start
```

Environment Variables:

```bash
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
CHROME_BUILD_ID=145.0.7632.77
```

## How to use

1. Create/select workspace.
2. Click `Start WhatsApp`.
2. Scan QR from mobile WhatsApp (`Linked devices`).
3. Save recipients and messages from the form.
4. Use `Send Startup Message` or `Send Now` for bulk sends.

## Notes

- Uses unofficial WhatsApp Web automation (`whatsapp-web.js`).
- Avoid spam and follow WhatsApp policies.

## Booking Agent API

Set Booking + Google Calendar env keys in `.env` first, then use:

- `GET /api/workspaces/:workspaceId/bookings`
- `POST /api/workspaces/:workspaceId/booking/intent`
- `GET /api/workspaces/:workspaceId/booking/slots?tz=UTC`
- `POST /api/workspaces/:workspaceId/booking/confirm`
- `POST /api/workspaces/:workspaceId/booking/cancel`
- `POST /api/workspaces/:workspaceId/booking/reminder-sweep`
