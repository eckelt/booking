# booking-page Specification

## Purpose

Statische Buchungsseite unter book.ecke.lt (Cloudflare Pages, Projekt `booking`): Dauer wählen, freien Slot wählen, Daten eingeben, buchen oder umbuchen. Ist-Zustand zu Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` (Landscape-Inventur 2026-09-27); Fundstellen `[datei:zeile]` beziehen sich auf diesen Commit.

## Requirements

### Requirement: Auslieferung
Das System SHALL die Dateien aus `frontend/` als Pages-Projekt `booking` unter `https://book.ecke.lt/` ausliefern und das gemeinsame Stylesheet des Design-Systems einbinden [Makefile:15-16; .github/workflows/deploy.yml:42; landscape:inventory/raw/cloudflare.yaml:15-19; frontend/index.html:18; frontend/styles.css:2].

#### Scenario: Stylesheet
- **WHEN** der Browser `/styles.css` lädt
- **THEN** importiert es `https://ecke-design-system.pages.dev/v1/styles.css` [frontend/styles.css:1-2]

### Requirement: Dauer wählen
Das System SHALL 30 oder 60 Minuten anbieten und die Dauer aus `?duration=` oder dem Pfad `/30min` bzw. `/60min` übernehmen [frontend/index.html:688-704; frontend/index.html:731-737].

#### Scenario: Kurzlink /30min
- **WHEN** jemand `https://book.ecke.lt/30min` öffnet
- **THEN** leitet die Seite per `location.replace` (ohne JavaScript per Meta-Refresh) auf `/?duration=30` weiter und behält übrige Query-Parameter [frontend/30min/index.html:5-11]

#### Scenario: Ohne Dauer
- **WHEN** weder Parameter noch Pfad eine Dauer vorgeben
- **THEN** zeigt die Seite die Auswahl 30/60 Minuten; nach der Wahl wird `duration=<d>` in die URL gesetzt, übrige Query-Parameter (Vorbelegung) bleiben erhalten [frontend/index.html, `pickDuration`]

### Requirement: Slots anzeigen
Das System SHALL für die nächsten 14 Tage die freien Slots mit einer einzigen Bereichsanfrage an `/api/slots` laden und bei Fehler pro Tag nachladen [frontend/index.html:1195-1222].

#### Scenario: Werktage
- **WHEN** der Kalender gerendert wird
- **THEN** sind nur Werktage bis maximal 14 Tage ab heute wählbar [frontend/index.html:1053-1056; frontend/index.html:1083-1090]

### Requirement: Buchen
Das System SHALL nach Slot-Wahl Name, E-Mail und Notiz abfragen und `POST /api/book` mit `start`, `duration`, `name`, `email`, `notes`, `lang` (`de` oder `en`) und `aiTitle` senden [frontend/index.html:1446-1459].

#### Scenario: Erfolg
- **WHEN** die API mit Erfolg antwortet
- **THEN** zeigt die Seite Termin und Meeting-Link und löscht die gespeicherte Notiz [frontend/index.html:1463-1485]

#### Scenario: Fehler
- **WHEN** die API einen Fehler meldet
- **THEN** zeigt die Seite die Fehlermeldung der API an [frontend/index.html:1462-1464; frontend/index.html:1486-1491]

#### Scenario: KI-Titel abwählen
- **WHEN** der Bucher den KI-Schalter ausschaltet
- **THEN** wird `aiTitle: false` gesendet und die Wahl im `localStorage` (`booking-ai-title`) gemerkt [frontend/index.html:1397; frontend/index.html:1407-1411; frontend/index.html:1456]

### Requirement: Umbuchen
Das System SHALL mit `?reschedule=<uid>&t=<token>` einen bestehenden Termin verschieben, dabei nur uid und neue Zeit senden und das Token `t` als Query-Parameter an `/api/reschedule-info` und `/api/book` durchreichen [frontend/index.html:744-748; frontend/index.html:1450; frontend/index.html:1461-1463; frontend/index.html:1624].

#### Scenario: Link ohne Dauer
- **WHEN** der Link nur `?reschedule=<uid>[&t=…]` enthält
- **THEN** holt die Seite die Dauer über `/api/reschedule-info`; schlägt das fehl (auch bei ungültigem Token), wird eine normale Neubuchung angeboten [frontend/index.html:1621-1636]

### Requirement: Vorbelegter Link für KI-Agenten
Das System SHALL unter `/llms.txt` eine Anleitung für KI-Agenten ausliefern (freie Slots über `GET /api/slots` holen, mit dem Kalender des Nutzers abgleichen, vorbelegten Link übergeben) und einen Link `/?duration=<d>&start=<ISO>&name=…&email=…&notes=…&lang=de|en` als vorausgefülltes Formular öffnen. Gebucht wird erst, wenn der Mensch bestätigt [frontend/llms.txt; frontend/index.html, `openPresetSlot`].

#### Scenario: Slot frei
- **WHEN** `start` (beliebige Offset-Schreibweise desselben Zeitpunkts) einem freien Slot entspricht
- **THEN** wählt die Seite Tag und Slot aus und öffnet das Formular mit Name, E-Mail und Notiz aus dem Link

#### Scenario: Slot vergeben
- **WHEN** `start` keinem freien Slot entspricht
- **THEN** zeigt die Seite einen Hinweis und, sofern der Tag noch buchbar ist, die übrigen Slots dieses Tages

#### Scenario: Auffindbarkeit
- **WHEN** ein Agent die Startseite lädt
- **THEN** verweisen `<meta name="description">` und `<link rel="alternate" type="text/markdown">` auf `/llms.txt`

### Requirement: Sprache und Speicherung
Das System SHALL zwischen Deutsch und Englisch umschalten und Sprache, Name, E-Mail und Notiz im `localStorage` halten [frontend/index.html:683-686; frontend/index.html:939-942; frontend/index.html:1356-1357; frontend/index.html:1390-1393].

#### Scenario: Erstaufruf
- **WHEN** weder `?lang=` gesetzt noch eine Sprache gespeichert ist
- **THEN** wird die Browsersprache genommen, wenn es dafür Texte gibt (en, de, es), sonst Englisch [frontend/index.html:1607-1609; frontend/index.html:752; frontend/index.html:800; frontend/index.html:850]

### Requirement: Rechtliche Links
Das System SHALL im Fuß auf Impressum und Datenschutz von nils.ecke.lt verlinken und oben zurück auf nils.ecke.lt [frontend/index.html:681; frontend/index.html:1642-1644].

#### Scenario: Datenschutzhinweis im Formular
- **WHEN** das Buchungsformular angezeigt wird
- **THEN** verweist der Hinweistext auf `https://nils.ecke.lt/datenschutz/` [frontend/index.html:787; frontend/index.html:836]
