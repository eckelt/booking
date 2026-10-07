# Tasks

- [x] `worker/src/links.ts`: Token signieren/prüfen (HMAC-SHA256, Zweck-Präfix, base64url), Übergangsfrist-Konstante, Links bauen
- [x] `worker/src/types.ts`: `LINK_SIGNING_SECRET` im Env-Typ
- [x] `worker/src/index.ts`: Prüfung in `/api/cancel`, `/api/reschedule-info`, `POST /api/book` (Umbuchung), `join.ecke.lt` / `/api/join`; Fehlerseite 403
- [x] `worker/src/booking.ts`: signierte Links für Mail, `.ics`, API-Antwort und Kalendereintrag (Host-Link unverändert)
- [x] `frontend/index.html`: `t` an `/api/reschedule-info` und `/api/book` durchreichen
- [x] Tests: `worker/test/links.test.ts` (Token, Frist mit injizierter Zeit, fail-closed, Handler), `worker/test/index.test.ts` mit Token
- [x] Doku: `wrangler.toml`, `STATUS.md`, `twin.json`, `openspec/project.md`
