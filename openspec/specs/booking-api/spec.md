# booking-api Specification

## Purpose

HTTP-API des Workers `booking-worker` unter `https://book.ecke.lt/api/*`: Slots, Buchung, Umbuchung, Storno und Meeting-Titel. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Routing und CORS
Das System SHALL auf der Route `book.ecke.lt/api/*` die Endpunkte `GET /api/slots`, `GET /api/reschedule-info`, `POST /api/book`, `GET /api/cancel` und `GET /api/join` bedienen und jede Antwort mit CORS-Headern für `https://book.ecke.lt` versehen [wrangler.toml:34-36; worker/src/index.ts:9-13; worker/src/index.ts:71-90; worker/src/index.ts:310-322].

#### Scenario: Preflight
- **WHEN** eine `OPTIONS`-Anfrage eintrifft
- **THEN** antwortet der Worker mit 204 und den CORS-Headern [worker/src/index.ts:67-69]

#### Scenario: Unbekannter Pfad
- **WHEN** kein Endpunkt passt
- **THEN** antwortet der Worker mit 404 `{"error":"not found"}`; unerwartete Fehler ergeben 500 `{"error":"internal error"}` [worker/src/index.ts:90-93]

### Requirement: Slots
Das System SHALL `GET /api/slots?duration=30|60&from=&to=[&reschedule=<uid>]` mit `{"slots":[{start,end}]}` in Berliner Ortszeit beantworten [worker/src/index.ts:146-229; worker/src/index.ts:329-337].

#### Scenario: Ungültige Parameter
- **WHEN** `duration` nicht 30 oder 60 ist oder `to` mehr als 14 Tage in der Zukunft liegt
- **THEN** antwortet der Worker mit 400 [worker/src/index.ts:147-150; worker/src/index.ts:152-163]

#### Scenario: Kalender nicht erreichbar
- **WHEN** die CalDAV-Abfrage fehlschlägt
- **THEN** antwortet der Worker mit 500 `{"error":"calendar unavailable"}` [worker/src/index.ts:187-190]

#### Scenario: Umbuchung
- **WHEN** `reschedule=<uid>` gesetzt ist
- **THEN** zählt der alte Termin nicht als belegt [worker/src/index.ts:199-203]

### Requirement: Buchung
Das System SHALL `POST /api/book` validieren, den Slot unmittelbar vor dem Schreiben erneut prüfen, den Termin anlegen und mit 201 `{uid,start,end,jitsiUrl}` antworten; `jitsiUrl` ist der signierte Meeting-Link [worker/src/index.ts:270-298; worker/src/booking.ts:132-150; worker/src/booking.ts:227-229; worker/src/booking.ts:261-266].

#### Scenario: Validierung
- **WHEN** `duration` nicht 30/60 ist, `start` nicht in der Zukunft oder mehr als 14 Tage entfernt liegt, `name` fehlt oder länger als 100 Zeichen ist oder `email` ungültig ist
- **THEN** antwortet der Worker mit 422 und der Fehlermeldung; Notizen werden auf 1000 Zeichen gekürzt [worker/src/booking.ts:29-64; worker/src/index.ts:283-288]

#### Scenario: Slot vergeben
- **WHEN** der Slot inzwischen belegt ist
- **THEN** antwortet der Worker mit 409 `slot no longer available` [worker/src/booking.ts:146-150; worker/src/index.ts:300-302]

#### Scenario: Umbuchung ohne gültiges Token
- **WHEN** die Anfrage `rescheduleUid` trägt und `?t=` kein gültiges `reschedule`-Token für diese uid ist (oder nach der Übergangsfrist fehlt)
- **THEN** antwortet der Worker mit 403 `Link ungültig oder abgelaufen`, ohne den Kalender zu ändern [worker/src/index.ts:290-294; worker/src/index.ts:44]

#### Scenario: Umbuchungsziel verschwunden
- **WHEN** `rescheduleUid` auf keinen Termin mehr zeigt und die Anfrage keine eigene Dauer, Name und E-Mail trägt
- **THEN** antwortet der Worker mit 410 [worker/src/booking.ts:106-110; worker/src/index.ts:303-305]

#### Scenario: Echte Umbuchung
- **WHEN** `rescheduleUid` auf einen bestehenden Termin zeigt
- **THEN** übernimmt der Worker Dauer, Name und E-Mail aus dem alten Termin und überschreibt dieselbe Kalender-Ressource (gleiche uid, gleicher Meeting-Link) [worker/src/booking.ts:95-104; worker/src/booking.ts:161-182]

### Requirement: Meeting-Titel und uid
Das System SHALL für eine Neubuchung Titel und uid (Slug) erzeugen: mit Notiz, `ANTHROPIC_API_KEY` und `aiTitle` per Anthropic-API (`claude-haiku-4-5`, Timeout 8 s), sonst „Termin mit <Name>“ bzw. „Meeting with <Name>“ [worker/src/booking.ts:118-124; worker/src/title.ts:6-7; worker/src/title.ts:29-58; worker/src/title.ts:62-70].

#### Scenario: Slug belegt
- **WHEN** das Anlegen mit einem Slug an einer bestehenden Ressource scheitert (HTTP 412)
- **THEN** versucht der Worker die Varianten mit Adjektiv und zuletzt den Slug mit 4 zufälligen Zeichen [worker/src/booking.ts:187-216; worker/src/caldav.ts:83]

#### Scenario: Modell nicht nutzbar
- **WHEN** der Aufruf fehlschlägt, abläuft oder unbrauchbares JSON liefert
- **THEN** nimmt der Worker den einfachen Titel [worker/src/title.ts:39-57]

### Requirement: Reschedule-Info
Das System SHALL `GET /api/reschedule-info?uid=&t=` mit der Dauer des Termins in Minuten beantworten, wenn `t` ein gültiges `reschedule`-Token ist [worker/src/index.ts:254-268].

#### Scenario: Unbekannte uid
- **WHEN** die uid ungültig ist oder kein Termin existiert
- **THEN** antwortet der Worker mit 400 bzw. 404 [worker/src/index.ts:256-258; worker/src/index.ts:262-265]

#### Scenario: Ungültiges Token
- **WHEN** `t` nicht passt (oder nach der Übergangsfrist fehlt)
- **THEN** antwortet der Worker mit 403 `Link ungültig oder abgelaufen` [worker/src/index.ts:259-261]

### Requirement: Storno
Das System SHALL `GET /api/cancel?uid=&t=` den Termin im Kalender löschen und eine HTML-Bestätigung zeigen, wenn `t` ein gültiges `cancel`-Token ist [worker/src/index.ts:310-339].

#### Scenario: Ungültige uid
- **WHEN** die uid nicht `^[\w-]+$` entspricht
- **THEN** zeigt der Worker eine Fehlerseite mit Status 400 [worker/src/index.ts:321-329]

#### Scenario: Ungültiges Token
- **WHEN** `t` nicht passt (oder nach der Übergangsfrist fehlt)
- **THEN** zeigt der Worker die Fehlerseite „Link ungültig oder abgelaufen“ mit Status 403 und löscht nichts [worker/src/index.ts:330-332; worker/src/index.ts:33-42]

### Requirement: Rate-Limiting
Das System SHALL Buchungen auf 5 und Stornos auf 10 pro IP und Stunde begrenzen; das KV-Binding `RATE_LIMIT` ist gebunden [worker/src/index.ts:112-127; worker/src/index.ts:270-273; worker/src/index.ts:310-317; wrangler.toml:37-39].

#### Scenario: Limit erreicht
- **WHEN** eine IP innerhalb einer Stunde mehr als 5 `POST /api/book` bzw. mehr als 10 `GET /api/cancel` sendet
- **THEN** antwortet der Worker mit 429, ohne die Anfrage weiter zu verarbeiten [worker/src/index.ts:271-273; worker/src/index.ts:311-317]

#### Scenario: Ohne Binding
- **WHEN** `RATE_LIMIT` fehlt
- **THEN** wird jede Anfrage durchgelassen [worker/src/index.ts:119]

### Requirement: Signierte Links
Das System SHALL Storno-, Umbuchungs- und Meeting-Links mit einem Token `t` absichern: base64url von HMAC-SHA256 über `booking-link:<zweck>:<uid>` mit dem Worker-Secret `LINK_SIGNING_SECRET`, getrennt je Zweck `cancel`, `reschedule` und `join`, ohne Speicherung; geprüft wird mit `crypto.subtle.verify` [worker/src/links.ts:10; worker/src/links.ts:20-23; worker/src/links.ts:51-68; worker/src/types.ts:21-24].

#### Scenario: Falsches Token
- **WHEN** eine Anfrage ein `t` trägt, das nicht zu Zweck und uid passt
- **THEN** wird sie abgelehnt, auch innerhalb der Übergangsfrist [worker/src/links.ts:75-86]

#### Scenario: Übergangsfrist für Altlinks
- **WHEN** eine Anfrage kein `t` trägt
- **THEN** wird sie bis einschließlich 2026-10-31 (Europe/Berlin, Konstante `UNSIGNED_LINK_GRACE_END`) akzeptiert und danach abgelehnt [worker/src/links.ts:12-17; worker/src/links.ts:87]

#### Scenario: Secret fehlt
- **WHEN** `LINK_SIGNING_SECRET` nicht gesetzt ist
- **THEN** werden Anfragen mit `t` abgelehnt, Anfragen ohne `t` gelten nur innerhalb der Übergangsfrist, und Links werden unsigniert erzeugt; die Warnung im Log enthält weder uid noch E-Mail [worker/src/links.ts:82-87; worker/src/links.ts:103-107]

#### Scenario: Erzeugte Links
- **WHEN** eine Buchung angelegt oder verschoben wird
- **THEN** tragen Meeting-Link (`https://join.ecke.lt/<uid>?t=`), Storno-Link (`/api/cancel?uid=<uid>&t=`) und Umbuchungs-Link (`/?reschedule=<uid>&t=`) je ihr eigenes Token [worker/src/links.ts:99-118; worker/src/booking.ts:227-229; worker/src/booking.ts:254-257]
