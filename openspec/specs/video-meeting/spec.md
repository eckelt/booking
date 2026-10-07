# video-meeting Specification

## Purpose

Meeting-Links unter join.ecke.lt, die je nach `VIDEO_PROVIDER` auf Google Meet, Microsoft Teams oder ein Videomeeting bei 8x8 JaaS weiterleiten. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Stabiler Link je Termin
Das System SHALL jedem Termin den Link `https://join.ecke.lt/<uid>?t=<join-token>` zuordnen und ihn in Mail, `.ics` des Buchers und API-Antwort verwenden; der Kalendereintrag des Owners enthält den Host-Link `?host=<HOST_JOIN_SECRET>` bzw. ohne Host-Secret den signierten Link [worker/src/booking.ts:168; worker/src/booking.ts:193; worker/src/booking.ts:227-229; worker/src/booking.ts:265; worker/src/links.ts:99-128].

#### Scenario: Umbuchung
- **WHEN** ein Termin verschoben wird
- **THEN** bleiben uid, Link und Token gleich [worker/src/booking.ts:161-168; worker/src/links.ts:20-23]

### Requirement: Anbieter-Schalter
Das System SHALL nach erfolgreicher Link-Prüfung den Anbieter aus `VIDEO_PROVIDER` wählen (`google` als Standard, `teams`, `jitsi`); `?via=<anbieter>` überschreibt das für einen einzelnen Aufruf [worker/src/video.ts; worker/src/index.ts].

#### Scenario: Erster Aufruf mit Meet/Teams
- **WHEN** der Anbieter `google` oder `teams` ist, die Zugangsdaten gesetzt sind und der Termin noch kein Meeting dieses Anbieters hat
- **THEN** legt der Worker ein Meeting an (Meet REST API `spaces.create` mit `accessType: OPEN` bzw. Graph `/me/onlineMeetings`), speichert es als `X-VIDEO-URL;X-PROVIDER=<anbieter>` am Termin (PUT mit `If-Match`) und leitet mit 302 dorthin weiter

#### Scenario: Gleichzeitiger Aufruf
- **WHEN** das Speichern mit 412 scheitert, weil der andere Teilnehmer schon ein Meeting gespeichert hat
- **THEN** leitet der Worker auf das gespeicherte Meeting weiter

#### Scenario: Folgeaufrufe und Umbuchung
- **WHEN** am Termin bereits ein Meeting desselben Anbieters gespeichert ist (auch nach einer Umbuchung)
- **THEN** leitet der Worker ohne API-Aufruf dorthin weiter

#### Scenario: Rückfall auf Jitsi
- **WHEN** Zugangsdaten fehlen, die API fehlschlägt oder die uid kein Termin ist
- **THEN** gilt die Weiterleitung zu 8x8 wie unten beschrieben

### Requirement: Weiterleitung zu 8x8
Das System SHALL `GET join.ecke.lt/<uid>?t=` (und `GET /api/join?uid=&t=`) mit 302 auf `https://8x8.vc/<JAAS_APP_ID>/<uid>?jwt=<token>` beantworten, wenn `t` ein gültiges `join`-Token ist oder `?host=` mit `HOST_JOIN_SECRET` übereinstimmt [wrangler.toml:41-43; worker/src/index.ts:98-103; worker/src/index.ts:146-162; worker/src/jitsi.ts:10-21].

#### Scenario: Ungültige uid
- **WHEN** die uid leer ist oder nicht `^[\w-]+$` entspricht
- **THEN** zeigt der Worker eine Fehlerseite mit Status 400 [worker/src/index.ts:137-145]

#### Scenario: Ungültiges Token
- **WHEN** weder ein gültiges `join`-Token noch das Host-Secret vorliegt (ohne `t` erst nach der Übergangsfrist)
- **THEN** zeigt der Worker die Fehlerseite „Link ungültig oder abgelaufen“ mit Status 403 [worker/src/index.ts:149-153; worker/src/index.ts:33-42]

#### Scenario: Keine Terminprüfung
- **WHEN** ein gültig signierter Link aufgerufen wird
- **THEN** leitet der Worker weiter, ohne den Kalender zu fragen oder ein Terminfenster zu prüfen [worker/src/index.ts:146-162]

### Requirement: JaaS-Token
Das System SHALL ein RS256-JWT mit `kid` `<JAAS_APP_ID>/<JAAS_KEY_ID>`, dem Raum = uid und ausgeschalteter Aufnahme, Livestream und Einwahl erzeugen und mit dem Secret `JAAS_PRIVATE_KEY` (PKCS#8) signieren [worker/src/jitsi.ts:23-66; worker/src/jitsi.ts:78-90; landscape:inventory/raw/cloudflare.yaml:50].

#### Scenario: Gültigkeit
- **WHEN** der Link aufgerufen wird
- **THEN** gilt das Token ab 15 Minuten vor dem Aufruf bis 2,5 Stunden danach [worker/src/index.ts:136-137; worker/src/jitsi.ts:33-34]

#### Scenario: Moderator
- **WHEN** `?host=` mit `HOST_JOIN_SECRET` übereinstimmt (zeitkonstanter Vergleich)
- **THEN** ist der Nutzer im Token Moderator mit `OWNER_NAME` und `OWNER_EMAIL`, sonst Gast ohne Moderatorrechte [worker/src/index.ts:115-120; worker/src/index.ts:132-142; worker/src/jitsi.ts:45-48]
