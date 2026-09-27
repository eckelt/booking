## MODIFIED Requirements

### Requirement: Mails nach einer Buchung
Das System SHALL nach jeder Buchung im Hintergrund eine Bestätigung an den Bucher (Text, HTML, `booking.ics` mit `METHOD:PUBLISH`, signierte Links zum Beitreten, Umbuchen und Stornieren) und eine Benachrichtigung an `OWNER_EMAIL` senden [worker/src/booking.ts:227-259; worker/src/email.ts:22-26; worker/src/email.ts:96-117; worker/src/email.ts:207-209].

#### Scenario: Wiederholung
- **WHEN** ein Versand fehlschlägt
- **THEN** wird er bis zu dreimal mit 0,5 s und 1 s Pause versucht [worker/src/email.ts:44-63]

#### Scenario: Bestätigung scheitert endgültig
- **WHEN** die Bestätigung an den Bucher nach allen Versuchen fehlschlägt
- **THEN** geht eine Warnmail „[ACTION NEEDED]“ mit den Kontaktdaten an `OWNER_EMAIL`; die Buchung bleibt bestehen [worker/src/email.ts:28-32; worker/src/email.ts:76-94; worker/src/booking.ts:231]

#### Scenario: Sprache
- **WHEN** die Bestätigung erzeugt wird
- **THEN** ist sie englisch, unabhängig von der Sprache der Buchung [worker/src/email.ts:96-143; worker/src/email.ts:161-184]
