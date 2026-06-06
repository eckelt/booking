# Architecture Spec — book.ecke.lt

## System Overview

```
Browser
  │  GET /30min           (Cloudflare Pages — static HTML/JS)
  │  GET /api/slots?duration=30&date=YYYY-MM-DD
  │  POST /api/book
  ▼
Cloudflare Worker  (book.ecke.lt/api/*)
  ├── CalDAV client  ──► Fastmail (PROPFIND)   reads Nils + Ohana
  ├── CalDAV writer  ──► Fastmail (PUT)         writes new event
  ├── SMTP client    ──► Fastmail SMTP          sends 2 emails
  └── Jitsi helper               generates meet URL (no API needed)
```

## Components

### 1. Cloudflare Pages
- Serves `frontend/` as a static site.
- Routes `book.ecke.lt/*` to Pages; `book.ecke.lt/api/*` overridden by Worker route.
- No build step required (plain HTML + vanilla JS).

### 2. Cloudflare Worker
- Single Worker script at `worker/src/index.ts`.
- Handles all `/api/*` routes.
- Deployed via Wrangler (`wrangler.toml`).

### 3. CalDAV Integration
- **Read**: PROPFIND + REPORT (calendar-query) on both `Nils` and `Ohana` calendars.
- **Write**: PUT a new VEVENT iCal to the `Nils` calendar.
- Auth: HTTP Basic (username = Fastmail account, password = app-specific password).

### 4. Email
- Protocol: SMTP over TLS (port 465) via Fastmail.
- Two emails per booking: confirmation to booker, notification to owner.
- Template: plain text + HTML, contains event details + Jitsi link.

### 5. Jitsi
- No API call needed. URL pattern: `https://meet.jit.si/<roomName>`
- `roomName` = `booking-<uuidv4>` (generated in Worker, stored in VEVENT).

## Infrastructure-as-Code Decision

| Resource | Approach | Rationale |
|---|---|---|
| Cloudflare Worker | `wrangler.toml` (IaC) | Native, zero overhead |
| Cloudflare Pages | `wrangler.toml` pages config | Supported since Wrangler v3 |
| Worker secrets | `wrangler secret put` (manual once) | Secrets can't be in repo; one-time setup |
| DNS / domain binding | Cloudflare dashboard (manual) | Single one-time step, no drift risk |

**Result**: everything except the initial secret injection and DNS click is reproducible from the repo.

## Directory Layout

```
booking/
├── docs/
│   ├── spec-architecture.md   (this file)
│   ├── spec-api.md
│   ├── spec-availability.md
│   ├── spec-caldav.md
│   ├── spec-email.md
│   └── spec-infrastructure.md
├── frontend/
│   ├── index.html             (redirect to /30min)
│   └── 30min/
│       └── index.html         (booking UI)
├── worker/
│   ├── src/
│   │   ├── index.ts           (Worker entry — router)
│   │   ├── availability.ts    (slot generation)
│   │   ├── caldav.ts          (PROPFIND / PUT)
│   │   ├── booking.ts         (orchestration)
│   │   ├── email.ts           (SMTP)
│   │   ├── jitsi.ts           (URL generation)
│   │   └── types.ts           (shared types)
│   ├── test/
│   │   ├── availability.test.ts
│   │   ├── caldav.test.ts
│   │   ├── booking.test.ts
│   │   ├── email.test.ts
│   │   └── jitsi.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
└── wrangler.toml
```
