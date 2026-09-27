# availability Specification

## Purpose

Regeln, nach denen der Worker aus belegten Zeiten freie Slots berechnet. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Arbeitszeiten
Das System SHALL Slots nur Montag bis Freitag von 9 bis 17 Uhr Europe/Berlin anbieten [worker/src/availability.ts:3; worker/src/availability.ts:6-15; worker/src/availability.ts:26-41].

#### Scenario: Wochenende
- **WHEN** ein Tag Samstag oder Sonntag ist
- **THEN** gibt es an diesem Tag keine Slots [worker/src/availability.ts:27-29]

### Requirement: Owner-Zeitzone
Das System SHALL in der Slot-Liste das Berliner Fenster zusätzlich auf `OWNER_MIN_HOUR` bis `OWNER_MAX_HOUR` in `OWNER_TZ` begrenzen (Vorgaben Europe/Berlin, 9, 17) [worker/src/index.ts:165-169; worker/src/availability.ts:37-54; wrangler.toml:22-29].

#### Scenario: Gleiche Zeitzone
- **WHEN** `OWNER_TZ` Europe/Berlin ist
- **THEN** ändert sich das Fenster nicht [worker/src/availability.ts:37-40]

#### Scenario: Prüfung bei Buchung
- **WHEN** `/api/book` den Slot erneut prüft
- **THEN** nutzt es nur das Berliner Fenster ohne Owner-Zeitzone [worker/src/booking.ts:142]

### Requirement: Puffer und Raster
Das System SHALL jeden belegten Termin um 5 Minuten davor und danach erweitern, überlappende Zeiten zusammenfassen und Slots der gewählten Dauer auf einem 30-Minuten-Raster erzeugen [worker/src/availability.ts:4; worker/src/availability.ts:56-80; worker/src/availability.ts:106-121; worker/src/availability.ts:144-163].

#### Scenario: 60-Minuten-Slot
- **WHEN** 60 Minuten gewählt sind
- **THEN** können Slots auch zur halben Stunde beginnen [worker/src/availability.ts:106-111]

### Requirement: Vorlauf und Horizont
Das System SHALL nur Slots in der Zukunft und höchstens 14 Tage im Voraus liefern [worker/src/index.ts:152-163; worker/src/index.ts:218; worker/src/booking.ts:10; worker/src/booking.ts:42-47].

#### Scenario: Heute
- **WHEN** der erste Tag der Anfrage heute ist
- **THEN** fehlen Slots, deren Beginn schon vorbei ist [worker/src/index.ts:212-218]

### Requirement: Belegt-Quellen
Das System SHALL die Termine beider Kalender `CALDAV_CALENDAR_NILS` und `CALDAV_CALENDAR_OHANA` als belegt werten, außer abgesagte (`STATUS:CANCELLED`), als frei markierte (`TRANSP:TRANSPARENT`) und ganztägige Einträge [worker/src/index.ts:182-186; worker/src/caldav.ts:309-313; worker/src/caldav.ts:323].

#### Scenario: Ganztagseintrag
- **WHEN** ein Termin nur ein Datum ohne Uhrzeit hat
- **THEN** blockiert er keine Slots [worker/src/caldav.ts:316-323; worker/src/caldav.ts:349-351]
