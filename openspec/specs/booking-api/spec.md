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
Das System SHALL `POST /api/book` validieren, den Slot unmittelbar vor dem Schreiben erneut prüfen, den Termin anlegen und mit 201 `{uid,start,end,jitsiUrl}` antworten [worker/src/index.ts:248-270; worker/src/booking.ts:131-149; worker/src/booking.ts:260-265].

#### Scenario: Validierung
- **WHEN** `duration` nicht 30/60 ist, `start` nicht in der Zukunft oder mehr als 14 Tage entfernt liegt, `name` fehlt oder länger als 100 Zeichen ist oder `email` ungültig ist
- **THEN** antwortet der Worker mit 422 und der Fehlermeldung; Notizen werden auf 1000 Zeichen gekürzt [worker/src/booking.ts:28-63; worker/src/index.ts:261-266]

#### Scenario: Slot vergeben
- **WHEN** der Slot inzwischen belegt ist
- **THEN** antwortet der Worker mit 409 `slot no longer available` [worker/src/booking.ts:145-149; worker/src/index.ts:272-274]

#### Scenario: Umbuchungsziel verschwunden
- **WHEN** `rescheduleUid` auf keinen Termin mehr zeigt und die Anfrage keine eigene Dauer, Name und E-Mail trägt
- **THEN** antwortet der Worker mit 410 [worker/src/booking.ts:105-109; worker/src/index.ts:275-277]

#### Scenario: Echte Umbuchung
- **WHEN** `rescheduleUid` auf einen bestehenden Termin zeigt
- **THEN** übernimmt der Worker Dauer, Name und E-Mail aus dem alten Termin und überschreibt dieselbe Kalender-Ressource (gleiche uid, gleicher Meeting-Link) [worker/src/booking.ts:94-103; worker/src/booking.ts:160-181]

### Requirement: Meeting-Titel und uid
Das System SHALL für eine Neubuchung Titel und uid (Slug) erzeugen: mit Notiz, `ANTHROPIC_API_KEY` und `aiTitle` per Anthropic-API (`claude-haiku-4-5`, Timeout 8 s), sonst „Termin mit <Name>“ bzw. „Meeting with <Name>“ [worker/src/booking.ts:118-124; worker/src/title.ts:6-7; worker/src/title.ts:29-58; worker/src/title.ts:62-70].

#### Scenario: Slug belegt
- **WHEN** das Anlegen mit einem Slug an einer bestehenden Ressource scheitert (HTTP 412)
- **THEN** versucht der Worker die Varianten mit Adjektiv und zuletzt den Slug mit 4 zufälligen Zeichen [worker/src/booking.ts:187-216; worker/src/caldav.ts:83]

#### Scenario: Modell nicht nutzbar
- **WHEN** der Aufruf fehlschlägt, abläuft oder unbrauchbares JSON liefert
- **THEN** nimmt der Worker den einfachen Titel [worker/src/title.ts:39-57]

### Requirement: Reschedule-Info
Das System SHALL `GET /api/reschedule-info?uid=` mit der Dauer des Termins in Minuten beantworten [worker/src/index.ts:235-246].

#### Scenario: Unbekannte uid
- **WHEN** die uid ungültig ist oder kein Termin existiert
- **THEN** antwortet der Worker mit 400 bzw. 404 [worker/src/index.ts:237-243]

### Requirement: Storno
Das System SHALL `GET /api/cancel?uid=` den Termin im Kalender löschen und eine HTML-Bestätigung zeigen; ein Token wird nicht geprüft [worker/src/index.ts:282-307].

#### Scenario: Ungültige uid
- **WHEN** die uid nicht `^[\w-]+$` entspricht
- **THEN** zeigt der Worker eine Fehlerseite mit Status 400 [worker/src/index.ts:293-301]

### Requirement: Rate-Limiting (nur mit Binding)
Das System SHALL Buchungen auf 5 und Stornos auf 10 pro IP und Stunde begrenzen, aber nur wenn das KV-Binding `RATE_LIMIT` vorhanden ist; derzeit ist es nicht gebunden [worker/src/index.ts:98-113; worker/src/index.ts:249-252; worker/src/index.ts:283-291; wrangler.toml:31-32; landscape:inventory/raw/cloudflare.yaml:64].

#### Scenario: Ohne Binding
- **WHEN** `RATE_LIMIT` fehlt
- **THEN** wird jede Anfrage durchgelassen [worker/src/index.ts:105]
