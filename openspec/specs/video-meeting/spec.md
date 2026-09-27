# video-meeting Specification

## Purpose

Meeting-Links unter join.ecke.lt, die auf ein Videomeeting bei 8x8 JaaS weiterleiten. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Stabiler Link je Termin
Das System SHALL jedem Termin den Link `https://join.ecke.lt/<uid>` zuordnen und ihn in Kalender, Mail und API-Antwort verwenden [worker/src/booking.ts:167; worker/src/booking.ts:193; worker/src/booking.ts:228; worker/src/booking.ts:264].

#### Scenario: Umbuchung
- **WHEN** ein Termin verschoben wird
- **THEN** bleiben uid und Link gleich [worker/src/booking.ts:160-167]

### Requirement: Weiterleitung zu 8x8
Das System SHALL `GET join.ecke.lt/<uid>` (und `GET /api/join?uid=`) mit 302 auf `https://8x8.vc/<JAAS_APP_ID>/<uid>?jwt=<token>` beantworten [wrangler.toml:38-40; worker/src/index.ts:84-89; worker/src/index.ts:138-143; worker/src/jitsi.ts:10-21].

#### Scenario: Ungültige uid
- **WHEN** die uid leer ist oder nicht `^[\w-]+$` entspricht
- **THEN** zeigt der Worker eine Fehlerseite mit Status 400 [worker/src/index.ts:123-131]

#### Scenario: Keine Terminprüfung
- **WHEN** eine formal gültige uid aufgerufen wird
- **THEN** leitet der Worker weiter, ohne den Kalender zu fragen [worker/src/index.ts:122-143]

### Requirement: JaaS-Token
Das System SHALL ein RS256-JWT mit `kid` `<JAAS_APP_ID>/<JAAS_KEY_ID>`, dem Raum = uid und ausgeschalteter Aufnahme, Livestream und Einwahl erzeugen und mit dem Secret `JAAS_PRIVATE_KEY` (PKCS#8) signieren [worker/src/jitsi.ts:23-66; worker/src/jitsi.ts:78-90; landscape:inventory/raw/cloudflare.yaml:50].

#### Scenario: Gültigkeit
- **WHEN** der Link aufgerufen wird
- **THEN** gilt das Token ab 15 Minuten vor dem Aufruf bis 2,5 Stunden danach [worker/src/index.ts:136-137; worker/src/jitsi.ts:33-34]

#### Scenario: Moderator
- **WHEN** `?host=` mit `HOST_JOIN_SECRET` übereinstimmt (zeitkonstanter Vergleich)
- **THEN** ist der Nutzer im Token Moderator mit `OWNER_NAME` und `OWNER_EMAIL`, sonst Gast ohne Moderatorrechte [worker/src/index.ts:115-120; worker/src/index.ts:132-142; worker/src/jitsi.ts:45-48]
