## ADDED Requirements

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

## MODIFIED Requirements

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
