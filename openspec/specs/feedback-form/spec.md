# feedback-form Specification

## Purpose

Einseitiges Feedbackformular für Workshops und Vorträge unter feedback.ecke.lt, betrieben vom Worker `booking-worker`. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Host-Weiche
Das System SHALL alle Anfragen an `feedback.ecke.lt` vor der Buchungs-API an das Feedbackmodul geben [wrangler.toml:42-46; worker/src/index.ts:55-65; worker/src/feedback.ts:11].

#### Scenario: Fehler
- **WHEN** das Feedbackmodul einen unerwarteten Fehler wirft
- **THEN** antwortet der Worker mit 500 `internal error` [worker/src/index.ts:59-64]

### Requirement: Veranstaltungen
Das System SHALL unter `/<slug>` das Formular für eine Veranstaltung aus `worker/src/feedback-events.json` und unter `/` ein allgemeines Formular zeigen [worker/src/feedback.ts:128-153; worker/src/feedback-events.json:1-7].

#### Scenario: Unbekannter Slug
- **WHEN** der Slug nicht im Katalog steht
- **THEN** zeigt der Worker eine Hinweisseite mit Status 404 [worker/src/feedback.ts:144-148]

#### Scenario: Geschlossen
- **WHEN** das Datum der Veranstaltung plus `openDays` (Vorgabe 10) in Berliner Zeit überschritten ist
- **THEN** zeigt der Worker eine Hinweisseite mit Status 410 [worker/src/feedback.ts:34; worker/src/feedback.ts:61-65; worker/src/feedback.ts:149-151]

### Requirement: Formular
Das System SHALL eine Bewertung (hoch, seitlich, runter), optionalen Text bis 5000 Zeichen und optionalen Namen bis 100 Zeichen abfragen, auf Deutsch oder Englisch, und dabei `styles.css` und Icons von book.ecke.lt laden [worker/src/feedback.ts:35-37; worker/src/feedback-page.ts:184-187; worker/src/feedback-page.ts:194-195; worker/src/feedback-page.ts:256-260].

#### Scenario: Daumen runter
- **WHEN** „runter“ ohne Text abgeschickt wird
- **THEN** lehnt die API mit 422 `reason_required` ab [worker/src/feedback.ts:90]

#### Scenario: Honeypot
- **WHEN** das versteckte Feld `website` gefüllt ist
- **THEN** antwortet die API mit Erfolg, verschickt aber nichts [worker/src/feedback.ts:163-166; worker/src/feedback-page.ts:262]

### Requirement: Absenden
Das System SHALL `POST /api/feedback` prüfen und als Mail verschicken; es speichert nichts [worker/src/feedback.ts:6-9; worker/src/feedback.ts:155-188].

#### Scenario: Falsche Methode
- **WHEN** `/api/feedback` nicht per POST oder eine andere Seite nicht per GET/HEAD aufgerufen wird
- **THEN** antwortet der Worker mit 405 [worker/src/feedback.ts:131-137]
