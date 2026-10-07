# email Specification

## Purpose

Mailversand des Workers per SMTP über Fastmail: Buchungsbestätigung, Owner-Benachrichtigung, Warnmail bei Fehlern und Feedback-Mails. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: SMTP-Versand
Das System SHALL Mails über eine TLS-Socket-Verbindung zu `smtp.fastmail.com:465` mit `AUTH PLAIN` aus den Secrets `SMTP_USERNAME` und `SMTP_PASSWORD` und dem Absender `OWNER_EMAIL` einliefern [worker/src/email.ts:227-229; worker/src/email.ts:278-298; landscape:inventory/raw/cloudflare.yaml:51-52].

#### Scenario: Ablehnung
- **WHEN** der Server in einem Schritt mit einem unerwarteten Code antwortet
- **THEN** bricht der Versand mit einem Fehler ab, der Schritt und Antwort nennt [worker/src/email.ts:269-276]

#### Scenario: Nachrichtenformat
- **WHEN** eine Mail HTML oder einen Anhang hat
- **THEN** wird sie als `multipart/mixed` mit `multipart/alternative` und optionalem `text/calendar`-Anhang (Base64) gebaut, sonst als Base64-`text/plain`; Betreffzeilen mit Nicht-ASCII werden als UTF-8-Encoded-Word kodiert [worker/src/email.ts:343-404]

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

### Requirement: Feedback-Mails
Das System SHALL jede Feedback-Antwort als deutsche Textmail an `FEEDBACK_EMAIL` (sonst `OWNER_EMAIL`) senden, mit Wiederholung wie bei Buchungen [worker/src/feedback.ts:97-126; worker/src/feedback.ts:182-188].

#### Scenario: Versand scheitert
- **WHEN** der Versand nach allen Versuchen scheitert
- **THEN** antwortet die API mit 502 `send_failed` [worker/src/feedback.ts:183-187]
