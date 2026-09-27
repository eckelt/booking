# Tasks

- [x] `wrangler.toml`: `[[kv_namespaces]]` binding `RATE_LIMIT`; Kommentar „To re-enable rate limiting …“ entfernt
- [x] `worker/src/types.ts`: `RATE_LIMIT?: KVNamespace` geprüft — war bereits vorhanden
- [x] Tests: `worker/test/rateLimit.test.ts` (KV-Fake; 429 bei `/api/book` nach 5, bei `/api/cancel` nach 10; Limit pro IP; ohne Binding kein Limit)
- [x] Doku: `twin.json`, `STATUS.md`, `openspec/project.md`, `openspec/specs/booking-api/spec.md`
