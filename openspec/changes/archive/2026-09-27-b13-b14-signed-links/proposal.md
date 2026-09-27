# B13/B14: Signierte Links für Storno, Umbuchung und Meeting-Beitritt

## Warum
Storno (`GET /api/cancel?uid=`), Umbuchung (`rescheduleUid`) und der Meeting-Link `join.ecke.lt/<uid>` funktionierten für jede bekannte oder erratene uid; die uid ist ein lesbarer Slug, oft nur aus dem Namen des Buchers abgeleitet (Ist-Spec booking, „Bekannte Lücken“; Backlog B13, B14 in ecke-lt-landscape).

## Was
- Neuer Worker-Secret `LINK_SIGNING_SECRET`. Links tragen ein Token `t` = base64url(HMAC-SHA256(`booking-link:<zweck>:<uid>`)), getrennt je Zweck `cancel`, `reschedule`, `join`. Keine Speicherung; Prüfung per `crypto.subtle.verify` (konstante Zeit).
- `/api/cancel`, `/api/reschedule-info`, `POST /api/book` mit `rescheduleUid` (Token als `?t=`) und `join.ecke.lt/<uid>` bzw. `/api/join` prüfen das Token. Falsches Token: immer 403 („Link ungültig oder abgelaufen“).
- Übergangsfrist: Anfragen ohne `t` werden bis einschließlich 2026-10-31 (Europe/Berlin) akzeptiert (Konstante `UNSIGNED_LINK_GRACE_END`), danach abgelehnt.
- Fehlt das Secret: Anfragen mit `t` werden abgelehnt (fail-closed), ohne `t` gilt die Übergangsfrist; Links werden unsigniert verschickt und eine Warnung ohne uid/E-Mail geloggt.
- Alle erzeugten Links (Bestätigungsmail Text/HTML, `.ics`, API-Antwort `jitsiUrl`, Kalendereintrag ohne Host-Secret) tragen das Token. Der Host-Link `?host=<HOST_JOIN_SECRET>` bleibt unverändert und braucht kein `t`.
- Join prüft nur die Signatur, kein Zeitfenster und keinen Kalender; das JaaS-JWT bleibt unverändert.
- Frontend reicht `t` aus `/?reschedule=<uid>&t=…` an `/api/reschedule-info` und `/api/book` durch.

## Auswirkungen
- Code: `worker/src/links.ts` (neu), `worker/src/index.ts`, `worker/src/booking.ts`, `worker/src/types.ts`, `frontend/index.html`; Tests `worker/test/links.test.ts` (neu), `worker/test/index.test.ts`.
- Doku: `wrangler.toml` (Kommentar), `STATUS.md` (Secret-Liste), `twin.json` (Secret-Name), `openspec/project.md` (Bekannte Lücken).
- Betrieb: Secret `LINK_SIGNING_SECRET` muss am Worker `booking-worker` gesetzt werden; das Pages-Projekt braucht es nicht.
- Nicht betroffen: Rate-Limiting (B3), Jitsi-Doku (B5/B6), `METHOD:PUBLISH` (B15), `/api/slots?reschedule=` (nur lesend).
