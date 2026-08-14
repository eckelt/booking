# book.ecke.lt — Status

## What works

- **book.ecke.lt/30min** — fully functional booking UI
- Slot availability: reads Fastmail CalDAV calendars (Nils + Ohana), respects working hours and 5-minute buffers
- Booking: creates a VEVENT in the Nils calendar via CalDAV PUT
- Optimistic concurrency: slot is re-checked immediately before writing
- Working hours: Mon–Fri 9–17, max 14 days ahead. Recurring afternoons that
  should stay free (e.g. Wed/Fri planning blocks) are held open with calendar
  events in the Nils calendar rather than hardcoded working hours.
- Meeting titles + join-link slugs: generated from the booker's name and note
  via Claude (Haiku), with a plain "Termin mit …" / "Meeting with …" fallback
  when there's no note, no `ANTHROPIC_API_KEY`, or the call fails. The language
  comes from the booking form's DE/EN toggle. On a slug collision the write
  tries pretty adjective variants ("Heiterer Termin mit …") before falling back
  to an invisible short suffix, so the Jitsi room and CalDAV filename stay
  unique without ugly links.

## What's pending

- **Email sending** — SMTP via raw TCP timed out. MailChannels (HTTP API, free, no account) is wired up in code but not yet confirmed working. Requires DNS records on ecke.lt (see below).

## Cloudflare setup

### Worker: `booking-worker`
- Handles all API traffic at `book.ecke.lt/api/*`
- Source: `worker/src/index.ts`, deployed via `wrangler deploy`
- Route: `book.ecke.lt/api/*` → `booking-worker` (defined in `wrangler.toml`)

**Secrets set on the Worker** (Workers & Pages → booking-worker → Settings → Variables and Secrets):
| Name | Purpose |
|---|---|
| `CALDAV_USERNAME` | Fastmail login (`nils@ecke.lt`) |
| `CALDAV_PASSWORD` | Fastmail app password with CalDAV read/write |
| `ANTHROPIC_API_KEY` | Claude API key for meeting-title generation. Optional — without it, titles use the plain fallback. Set via `wrangler secret put ANTHROPIC_API_KEY`. |
| `SMTP_USERNAME` | Fastmail login — **now obsolete**, can be deleted |
| `SMTP_PASSWORD` | Fastmail SMTP app password — **now obsolete**, can be deleted |

**Non-secret vars** (in `wrangler.toml`):
| Name | Value |
|---|---|
| `OWNER_NAME` | Nils Eckelt |
| `OWNER_EMAIL` | nils@ecke.lt |
| `CALDAV_CALENDAR_NILS` | `bd0ce304-f055-4524-9273-80a7d8cee9f1` (Fastmail UUID for "Nils") |
| `CALDAV_CALENDAR_OHANA` | `0C692FAB-66C9-454F-B51D-D076560588DB` (Fastmail UUID for "Ohana") |

### Pages: `booking`
- Serves static frontend at `book.ecke.lt`
- Source: `frontend/` directory, deployed via `wrangler pages deploy`
- Custom domain: `book.ecke.lt` (configured in Pages → Custom domains)
- Production branch: `main`

**Secrets mistakenly set on the Pages project** — these do nothing and should be deleted (Workers & Pages → booking (Pages) → Settings → Environment Variables):
- `CALDAV_USERNAME`
- `CALDAV_PASSWORD`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`

### DNS (ecke.lt zone)
- `book.ecke.lt` → CNAME to Pages project (managed by Cloudflare)
- Worker route `book.ecke.lt/api/*` takes priority over Pages for API calls

## Next steps

### 1. Clean up Cloudflare secrets
- **Worker** (booking-worker → Settings → Variables and Secrets): delete `SMTP_USERNAME` and `SMTP_PASSWORD`
- **Pages project** (booking → Settings → Environment Variables): delete all four secrets (`CALDAV_USERNAME`, `CALDAV_PASSWORD`, `SMTP_USERNAME`, `SMTP_PASSWORD`) — these were set by mistake and have no effect

### 2. Fix email sending
The code now uses MailChannels (HTTP API, free, no signup). To make it work, add these DNS records to `ecke.lt` in Cloudflare:

**SPF** (add to existing record or create new):
```
Type: TXT
Name: @
Value: v=spf1 include:relay.mailchannels.net ~all
```

**Domain Lockdown** (prevents abuse of your domain by others):
```
Type: TXT
Name: _mailchannels
Value: v=mc1 cfid=booking-worker.nils.workers.dev
```

Alternative: use [Resend](https://resend.com) (free tier, 3k emails/month) — requires account + API key secret on the Worker.

### 3. Add 60-minute booking page
- Create `frontend/60min/index.html` (same as 30min but with `DURATION = 60`)
