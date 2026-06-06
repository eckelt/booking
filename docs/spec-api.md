# API Spec — book.ecke.lt Worker

Base path: `/api`

## GET /api/slots

Returns available booking slots for a given duration and date range.

### Query Parameters

| Param | Required | Default | Description |
|---|---|---|---|
| `duration` | no | `30` | Slot length in minutes. Supported: `30`, `60` |
| `from` | no | today | ISO date `YYYY-MM-DD`. Start of range (inclusive) |
| `to` | no | today + 14d | ISO date `YYYY-MM-DD`. End of range (inclusive) |

### Response 200

```json
{
  "slots": [
    {
      "start": "2026-06-08T09:00:00+02:00",
      "end":   "2026-06-08T09:30:00+02:00"
    },
    {
      "start": "2026-06-08T09:35:00+02:00",
      "end":   "2026-06-08T10:05:00+02:00"
    }
  ]
}
```

- Times are in Europe/Berlin timezone (ISO 8601 with offset).
- Slots are ordered chronologically.
- An empty `slots` array means no availability in the requested range.

### Response 400

```json
{ "error": "duration must be 30 or 60" }
```

### Response 500

```json
{ "error": "calendar unavailable" }
```

---

## POST /api/book

Creates a booking: writes a VEVENT to CalDAV, sends two emails.

### Request Body (JSON)

```json
{
  "start":    "2026-06-08T09:00:00+02:00",
  "duration": 30,
  "name":     "Jane Doe",
  "email":    "jane@example.com",
  "notes":    "Optional free-text notes"
}
```

| Field | Required | Validation |
|---|---|---|
| `start` | yes | ISO 8601 datetime; must match an available slot from `/api/slots` |
| `duration` | yes | 30 or 60 |
| `name` | yes | 1–100 chars |
| `email` | yes | valid email format |
| `notes` | no | max 1000 chars |

### Response 201

```json
{
  "uid":      "booking-550e8400-e29b-41d4-a716-446655440000",
  "start":    "2026-06-08T09:00:00+02:00",
  "end":      "2026-06-08T09:30:00+02:00",
  "jitsiUrl": "https://meet.jit.si/booking-550e8400-e29b-41d4-a716-446655440000"
}
```

### Response 409

Slot is no longer available (race condition — booked between GET /slots and POST /book).

```json
{ "error": "slot no longer available" }
```

### Response 400

```json
{ "error": "invalid start time" }
```

### Response 422

```json
{ "error": "name is required" }
```

---

## CORS

All `/api/*` responses include:

```
Access-Control-Allow-Origin: https://book.ecke.lt
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Preflight `OPTIONS` requests return 204 with the above headers.
