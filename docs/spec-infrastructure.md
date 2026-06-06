# Infrastructure Spec

## Overview

All infrastructure is managed via `wrangler.toml` (IaC). Secrets are injected once via `wrangler secret put` (not stored in repo). DNS and the Pages custom domain are one-time manual steps in the Cloudflare dashboard.

## wrangler.toml

```toml
name = "booking-worker"
main = "worker/src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
OWNER_NAME = "Nils Eckelt"
OWNER_EMAIL = "nils@ecke.lt"
CALDAV_CALENDAR_NILS = "Nils"
CALDAV_CALENDAR_OHANA = "Ohana"

[[routes]]
pattern = "book.ecke.lt/api/*"
zone_name = "ecke.lt"

[pages]
# Pages is configured separately via `wrangler pages deploy`
# see Makefile targets
```

Non-secret vars (`OWNER_NAME`, `OWNER_EMAIL`, calendar names) live in `wrangler.toml` directly.

## Secrets (run once, not in repo)

```bash
wrangler secret put CALDAV_USERNAME
wrangler secret put CALDAV_PASSWORD
wrangler secret put SMTP_USERNAME
wrangler secret put SMTP_PASSWORD
```

## Cloudflare Pages

Pages project name: `booking`  
Build command: none (static files)  
Build output directory: `frontend/`  
Custom domain: `book.ecke.lt`

Deploy command (CI/CD or manual):
```bash
wrangler pages deploy frontend/ --project-name booking
```

## Worker Deployment

```bash
cd worker && npm ci && npx wrangler deploy
```

## DNS (manual, one-time)

In the Cloudflare dashboard for `ecke.lt`:
1. Pages project automatically adds a `CNAME book → pages.dev` record.
2. The Worker route `book.ecke.lt/api/*` intercepts API calls before Pages serves them.

No Terraform or external IaC tool needed — the overhead would exceed the benefit for a single-domain, single-worker setup.

## CI/CD (GitHub Actions)

File: `.github/workflows/deploy.yml`

```yaml
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd worker && npm ci && npm test

  deploy-worker:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd worker && npm ci && npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

  deploy-pages:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx wrangler pages deploy frontend/ --project-name booking
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

GitHub secret required: `CLOUDFLARE_API_TOKEN` with permissions:
- Account: Cloudflare Pages — Edit
- Zone: Workers Routes — Edit

## Makefile (local dev convenience)

```makefile
.PHONY: test deploy-worker deploy-pages dev

test:
	cd worker && npm test

dev:
	cd worker && npx wrangler dev --local

deploy-worker:
	cd worker && npx wrangler deploy

deploy-pages:
	npx wrangler pages deploy frontend/ --project-name booking

secrets:
	wrangler secret put CALDAV_USERNAME
	wrangler secret put CALDAV_PASSWORD
	wrangler secret put SMTP_USERNAME
	wrangler secret put SMTP_PASSWORD
```

## Environment Checklist (before first deploy)

- [ ] Cloudflare account with `ecke.lt` zone active
- [ ] Pages project `booking` created (`wrangler pages project create booking`)
- [ ] `CLOUDFLARE_API_TOKEN` set in GitHub repo secrets
- [ ] Fastmail CalDAV app password created (scope: CalDAV)
- [ ] Fastmail SMTP app password created (scope: SMTP)
- [ ] `wrangler secret put` run for all 4 secrets
- [ ] `book.ecke.lt` custom domain added to Pages project in dashboard
- [ ] Worker route `book.ecke.lt/api/*` verified in Cloudflare dashboard
