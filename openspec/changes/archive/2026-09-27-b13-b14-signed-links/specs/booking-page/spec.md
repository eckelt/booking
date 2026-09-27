## MODIFIED Requirements

### Requirement: Umbuchen
Das System SHALL mit `?reschedule=<uid>&t=<token>` einen bestehenden Termin verschieben, dabei nur uid und neue Zeit senden und das Token `t` als Query-Parameter an `/api/reschedule-info` und `/api/book` durchreichen [frontend/index.html:744-748; frontend/index.html:1450; frontend/index.html:1461-1463; frontend/index.html:1624].

#### Scenario: Link ohne Dauer
- **WHEN** der Link nur `?reschedule=<uid>[&t=…]` enthält
- **THEN** holt die Seite die Dauer über `/api/reschedule-info`; schlägt das fehl (auch bei ungültigem Token), wird eine normale Neubuchung angeboten [frontend/index.html:1621-1636]
