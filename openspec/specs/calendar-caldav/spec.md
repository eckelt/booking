# calendar-caldav Specification

## Purpose

Anbindung an Fastmail per CalDAV: Belegt-Zeiten lesen, gebuchte Termine anlegen, lesen, überschreiben und löschen. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Verbindung
Das System SHALL `https://caldav.fastmail.com/dav/calendars/user/<CALDAV_USERNAME>/<Kalender>/` mit Basic Auth aus den Secrets `CALDAV_USERNAME` und `CALDAV_PASSWORD` ansprechen [worker/src/caldav.ts:4-12; landscape:inventory/raw/cloudflare.yaml:47-48].

#### Scenario: Secrets setzen
- **WHEN** die Secrets von Hand gesetzt werden
- **THEN** geschieht das mit `wrangler secret put` (`make secrets`) [Makefile:18-21]

### Requirement: Belegt-Zeiten lesen
Das System SHALL je Kalender eine `REPORT`-Anfrage (`calendar-query` mit `expand` und `time-range`) für den ganzen Zeitraum stellen und daraus Zeitintervalle mit uid lesen [worker/src/caldav.ts:18-43; worker/src/caldav.ts:245-272; worker/src/caldav.ts:274-288].

#### Scenario: Fehler
- **WHEN** Fastmail nicht mit 2xx antwortet
- **THEN** wirft die Abfrage einen Fehler mit Status und Anfang des Antworttexts [worker/src/caldav.ts:36-39]

### Requirement: Termin anlegen und überschreiben
Das System SHALL Buchungen als `<uid>.ics` per `PUT` im Kalender `CALDAV_CALENDAR_NILS` speichern, bei Neubuchung nur mit `If-None-Match: *` [worker/src/caldav.ts:61-88].

#### Scenario: Ressource existiert
- **WHEN** Fastmail mit 412 antwortet
- **THEN** meldet die Funktion einen Konflikt, damit ein anderer Slug versucht wird [worker/src/caldav.ts:83]

#### Scenario: Umbuchung
- **WHEN** ein Termin verschoben wird
- **THEN** wird ohne `If-None-Match` überschrieben [worker/src/caldav.ts:78; worker/src/booking.ts:181]

### Requirement: Termin lesen und löschen
Das System SHALL einen Termin per `GET` lesen (Titel, Zeit, Notiz, Name und E-Mail aus `ATTENDEE`) und per `DELETE` löschen; 404 gilt beim Lesen als „nicht vorhanden“ und beim Löschen als Erfolg [worker/src/caldav.ts:45-59; worker/src/caldav.ts:94-126; worker/src/caldav.ts:132-141].

#### Scenario: Unbekannte uid
- **WHEN** `GET` 404 liefert
- **THEN** gibt die Funktion `null` zurück [worker/src/caldav.ts:104]

### Requirement: iCalendar-Format
Das System SHALL Termine mit `DTSTART`/`DTEND` in `TZID=Europe/Berlin`, Titel, Meeting-Link als `LOCATION` und `X-JITSI-URL`, Notiz/Name/E-Mail in `DESCRIPTION`, `ORGANIZER` und `ATTENDEE` mit `SCHEDULE-AGENT=NONE` und einer Erinnerung 10 Minuten vorher schreiben [worker/src/caldav.ts:159-221].

#### Scenario: Owner-Link
- **WHEN** `HOST_JOIN_SECRET` gesetzt ist
- **THEN** enthält der Termin im Owner-Kalender den Meeting-Link mit `?host=<HOST_JOIN_SECRET>`, die Datei für den Bucher nicht [worker/src/booking.ts:167-168; worker/src/booking.ts:193-194; worker/src/booking.ts:228-242]

#### Scenario: Sonderzeichen
- **WHEN** Name oder Notiz Zeilenumbrüche, `;`, `,` oder einen Backslash enthalten
- **THEN** werden sie nach RFC 5545 maskiert [worker/src/caldav.ts:194; worker/src/caldav.ts:225-231]
