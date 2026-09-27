## MODIFIED Requirements

### Requirement: Stabiler Link je Termin
Das System SHALL jedem Termin den Link `https://join.ecke.lt/<uid>?t=<join-token>` zuordnen und ihn in Mail, `.ics` des Buchers und API-Antwort verwenden; der Kalendereintrag des Owners enthält den Host-Link `?host=<HOST_JOIN_SECRET>` bzw. ohne Host-Secret den signierten Link [worker/src/booking.ts:168; worker/src/booking.ts:193; worker/src/booking.ts:227-229; worker/src/booking.ts:265; worker/src/links.ts:99-128].

#### Scenario: Umbuchung
- **WHEN** ein Termin verschoben wird
- **THEN** bleiben uid, Link und Token gleich [worker/src/booking.ts:161-168; worker/src/links.ts:20-23]

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
