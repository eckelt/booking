# Email Spec

## Transport

- Protocol: SMTP with implicit TLS (SMTPS, port 465)
- Host: `smtp.fastmail.com`
- Auth: PLAIN (`SMTP_USERNAME`, `SMTP_PASSWORD`)
- `SMTP_PASSWORD`: Fastmail app-specific password (SMTP scope) — may be the same app password as CalDAV if Fastmail allows combined scope, otherwise separate.

**Note on Cloudflare Workers + SMTP**: Workers do not support raw TCP sockets via the standard Fetch API. Use the [Cloudflare `connect()` API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) (available in Workers) to open a TCP socket and implement SMTP manually, or use a transactional email API as a fallback. 

**Decision**: Use the native `connect()` socket API to talk SMTP directly. This avoids adding a third-party email service and keeps all credentials in-house (Fastmail). The Worker sends raw SMTP commands over the TCP socket.

If `connect()` proves unreliable in testing, fallback: Fastmail supports sending via their API — but that requires an additional API token and is outside the stated constraints. Document as a known risk.

## Emails Sent Per Booking

### 1. Confirmation to Booker

**From**: `{OWNER_NAME} <{OWNER_EMAIL}>`  
**To**: `{name} <{bookerEmail}>`  
**Subject**: `Booking confirmed: {duration} min with {OWNER_NAME} on {date}`  
**Reply-To**: `{OWNER_EMAIL}`

**Body (plain text)**:
```
Hi {name},

your booking is confirmed.

Date:     {weekday}, {date}
Time:     {startTime} – {endTime} (Europe/Berlin)
Duration: {duration} minutes

Join the video call here:
{jitsiUrl}

(No app needed — works in your browser.)

Notes you left:
{notes or "—"}

Looking forward to talking!
{OWNER_NAME}
```

**Body (HTML)**: Same content wrapped in a minimal, inline-styled HTML email. No external resources. Single-column layout.

**Attached**: `booking.ics` — a VCALENDAR file with the VEVENT (same content as written to CalDAV) so the booker can add it to their calendar.

### 2. Notification to Owner

**From**: `book.ecke.lt <{OWNER_EMAIL}>`  
**To**: `{OWNER_EMAIL}`  
**Subject**: `New booking: {name} — {date} {startTime}`

**Body (plain text)**:
```
New booking received via book.ecke.lt

Name:  {name}
Email: {bookerEmail}
Date:  {weekday}, {date}
Time:  {startTime} – {endTime} (Europe/Berlin)

Jitsi: {jitsiUrl}

Notes:
{notes or "—"}

The event has been added to your Nils calendar.
```

No .ics attachment for owner (already in calendar).

## Email Formatting Helpers

```typescript
function formatDate(d: Date, tz: string): string  // "Monday, 8 June 2026"
function formatTime(d: Date, tz: string): string  // "09:00"
```

## Environment Variables

| Variable | Description |
|---|---|
| `SMTP_USERNAME` | Fastmail account username |
| `SMTP_PASSWORD` | App-specific password (SMTP scope) |
| `OWNER_EMAIL` | `nils@ecke.lt` (destination for owner notifications) |
| `OWNER_NAME` | Display name, e.g. `Nils Eckelt` |

## Test Cases (email.test.ts)

Tests mock the SMTP socket — verify the correct SMTP commands are issued and email content is correct.

| Scenario | Expectation |
|---|---|
| Booking with notes | notes appear in both emails |
| Booking without notes | "—" appears in body |
| Subject contains correct date | formatted date matches `start` |
| .ics attachment on booker email | base64-encoded VCALENDAR in MIME part |
| Owner email has no .ics | only one MIME part (text) |
| SMTP AUTH PLAIN format | correctly base64-encodes `\0user\0pass` |
