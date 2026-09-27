# B3: KV-Namespace `RATE_LIMIT` binden — Rate-Limiting aktivieren

## Warum
Der Worker prüft Rate-Limits (5 Buchungen/h, 10 Stornos/h pro IP) nur, wenn das KV-Binding `RATE_LIMIT` gebunden ist; das Binding fehlte in `wrangler.toml` und live, sodass die Prüfung stets durchgelassen hat (Ist-Spec booking, „Bekannte Lücken“ C4; Backlog B3 in ecke-lt-landscape). Der Nutzer hat den Namespace angelegt (Binding `RATE_LIMIT`, id nur in `wrangler.toml`) und möchte ihn jetzt aktivieren.

## Was
- `wrangler.toml`: `[[kv_namespaces]]` mit `binding = "RATE_LIMIT"` und der id des Namespace; der Kommentar „To re-enable rate limiting …“ entfällt.
- Keine Änderung an `checkRateLimit` selbst (Limits, Fenster, Verhalten ohne Binding bleiben identisch) — die Funktion existierte bereits, nur ihr `if (!env.RATE_LIMIT) return true;`-Zweig griff bisher immer.
- Neue Tests (`worker/test/rateLimit.test.ts`) mit einem KV-Fake: Limit erreicht → 429 bei `/api/book` (nach 5) und `/api/cancel` (nach 10); Limit ist pro IP; ohne Binding wird jede Anfrage durchgelassen.
- `worker/src/types.ts` (`Env.RATE_LIMIT?: KVNamespace`) war bereits vorhanden, keine Änderung nötig.

## Auswirkungen
- Code: `wrangler.toml`.
- Tests: `worker/test/rateLimit.test.ts` (neu).
- Doku: `twin.json` (KV-Binding/Consumes `cloudflare-kv:kv@1`), `STATUS.md`, `openspec/project.md` (Bekannte Lücken C4 → B3 entfernt), `openspec/specs/booking-api/spec.md` (Requirement „Rate-Limiting“ ohne den Vorbehalt „nur mit Binding“).
- Betrieb: Der KV-Namespace ist bereits angelegt (Nutzer-Auskunft); nach dem nächsten `wrangler deploy` (Push auf `main`) greifen die Limits live.
- Nicht betroffen: alle anderen Endpunkte und Capabilities.
