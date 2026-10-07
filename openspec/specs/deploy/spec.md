# deploy Specification

## Purpose

Test und Auslieferung von Worker und Frontend per GitHub Actions und Wrangler auf Cloudflare. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Deploy bei jedem Push
Das System SHALL bei jedem Push auf `main` ohne Pfadfilter zuerst die Tests ausführen und danach Worker und Pages deployen [.github/workflows/deploy.yml:3-5; .github/workflows/deploy.yml:8-17; .github/workflows/deploy.yml:19-21; .github/workflows/deploy.yml:33-35].

#### Scenario: Tests schlagen fehl
- **WHEN** `npm test` (vitest) fehlschlägt
- **THEN** laufen die Deploy-Jobs nicht [.github/workflows/deploy.yml:17; .github/workflows/deploy.yml:20; .github/workflows/deploy.yml:34; worker/package.json:6]

#### Scenario: Doku-Commit
- **WHEN** ein Push nur Dokumentation oder Specs ändert
- **THEN** werden Worker und Pages trotzdem neu deployt [.github/workflows/deploy.yml:3-5; landscape:landscape.yaml:44]

### Requirement: Worker-Deploy
Das System SHALL den Worker `booking-worker` mit `npx wrangler deploy` und dem GitHub-Secret `CLOUDFLARE_API_TOKEN` deployen [.github/workflows/deploy.yml:29-31; wrangler.toml:1-3].

#### Scenario: Routen
- **WHEN** der Worker deployt ist
- **THEN** bedient er die Routen `book.ecke.lt/api/*`, `join.ecke.lt/*` und `feedback.ecke.lt/*` in der Zone ecke.lt [wrangler.toml:34-46; landscape:inventory/raw/cloudflare.yaml:41]

### Requirement: Pages-Deploy
Das System SHALL `frontend/` mit `wrangler pages deploy frontend/ --project-name booking --branch main` und `CLOUDFLARE_API_TOKEN` deployen [.github/workflows/deploy.yml:41-45].

#### Scenario: Domain
- **WHEN** das Pages-Projekt deployt ist
- **THEN** ist es unter book.ecke.lt erreichbar (CNAME auf das Pages-Projekt, proxied) [landscape:inventory/raw/cloudflare.yaml:15-19; landscape:inventory/raw/cloudflare.yaml:104]

### Requirement: Manueller Weg
Das System SHALL Deploy und Secrets auch lokal über das Makefile erlauben [Makefile:12-23].

#### Scenario: Secrets
- **WHEN** `make secrets` läuft
- **THEN** werden `CALDAV_USERNAME`, `CALDAV_PASSWORD`, `SMTP_USERNAME` und `SMTP_PASSWORD` per `wrangler secret put` abgefragt; `JAAS_PRIVATE_KEY`, `HOST_JOIN_SECRET` und `ANTHROPIC_API_KEY` sind dort nicht enthalten [Makefile:18-23; landscape:inventory/raw/cloudflare.yaml:45-52]
