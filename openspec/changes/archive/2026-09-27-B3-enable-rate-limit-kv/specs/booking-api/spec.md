## RENAMED Requirements
- FROM: `### Requirement: Rate-Limiting (nur mit Binding)`
- TO: `### Requirement: Rate-Limiting`

## MODIFIED Requirements

### Requirement: Rate-Limiting
Das System SHALL Buchungen auf 5 und Stornos auf 10 pro IP und Stunde begrenzen; das KV-Binding `RATE_LIMIT` ist gebunden [worker/src/index.ts:112-127; worker/src/index.ts:270-273; worker/src/index.ts:310-317; wrangler.toml:37-39].

#### Scenario: Limit erreicht
- **WHEN** eine IP innerhalb einer Stunde mehr als 5 `POST /api/book` bzw. mehr als 10 `GET /api/cancel` sendet
- **THEN** antwortet der Worker mit 429, ohne die Anfrage weiter zu verarbeiten [worker/src/index.ts:271-273; worker/src/index.ts:311-317]

#### Scenario: Ohne Binding
- **WHEN** `RATE_LIMIT` fehlt
- **THEN** wird jede Anfrage durchgelassen [worker/src/index.ts:119]
