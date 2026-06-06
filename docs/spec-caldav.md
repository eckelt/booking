# CalDAV Integration Spec

## Fastmail CalDAV Endpoint

```
Base URL: https://caldav.fastmail.com/dav/
Calendar home: /dav/calendars/user/<CALDAV_USERNAME>/
Nils calendar:  /dav/calendars/user/<CALDAV_USERNAME>/Nils/
Ohana calendar: /dav/calendars/user/<CALDAV_USERNAME>/Ohana/
```

Auth: HTTP Basic — `Authorization: Basic base64(<CALDAV_USERNAME>:<CALDAV_PASSWORD>)`

`CALDAV_PASSWORD` must be a Fastmail **app-specific password** (not the account password), generated at Fastmail → Settings → Privacy & Security → App Passwords. Scope: CalDAV.

## Reading Busy Times (REPORT)

Use `REPORT` with a `calendar-query` body to fetch VEVENTs in a time range. This is more efficient than PROPFIND + GET each event.

### Request

```http
REPORT /dav/calendars/user/{CALDAV_USERNAME}/{calendarName}/ HTTP/1.1
Host: caldav.fastmail.com
Authorization: Basic ...
Content-Type: application/xml; charset=utf-8
Depth: 1

<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data>
      <c:comp name="VCALENDAR">
        <c:comp name="VEVENT">
          <c:prop name="DTSTART"/>
          <c:prop name="DTEND"/>
          <c:prop name="DURATION"/>
          <c:prop name="STATUS"/>
          <c:prop name="TRANSP"/>
        </c:comp>
      </c:comp>
    </c:calendar-data>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{dtStart}" end="{dtEnd}"/>
        <!-- dtStart/dtEnd format: 20260608T000000Z -->
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
```

### Parsing Rules

- Ignore events with `STATUS:CANCELLED`.
- Ignore events with `TRANSP:TRANSPARENT` (free/show-as-free).
- `DTSTART` may be a DATE (all-day) or DATETIME. All-day events block the entire day.
- `DTEND` may be absent; derive from `DTSTART + DURATION` if present.
- All datetimes must be converted to UTC for interval arithmetic.
- Recurring events (RRULE): expand within the query range. Use a minimal rrule expander or fetch expanded data from Fastmail (Fastmail expands recurrences in REPORT responses).

### Response Parsing

Parse the multi-status XML. For each `<response>` with `<propstat><status>HTTP/1.1 200 OK</status>`:
1. Extract `<calendar-data>` text.
2. Parse the iCal text with a lightweight VEVENT parser (no full ical lib needed — only a few properties).

## Writing a Booking (PUT)

### iCal Template

```ical
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//book.ecke.lt//Booking//EN
BEGIN:VEVENT
UID:{uid}
DTSTAMP:{now}Z
DTSTART;TZID=Europe/Berlin:{dtStart}
DTEND;TZID=Europe/Berlin:{dtEnd}
SUMMARY:Meeting with {name}
DESCRIPTION:Booked via book.ecke.lt\nNotes: {notes}\nJitsi: {jitsiUrl}
ORGANIZER;CN=Nils Eckelt:mailto:{OWNER_EMAIL}
ATTENDEE;CN={name}:mailto:{bookerEmail}
X-JITSI-URL:{jitsiUrl}
END:VEVENT
END:VCALENDAR
```

Datetime format: `YYYYMMDDTHHmmss` (local, with TZID) or `YYYYMMDDTHHmmssZ` (UTC for DTSTAMP).

### Request

```http
PUT /dav/calendars/user/{CALDAV_USERNAME}/Nils/{uid}.ics HTTP/1.1
Host: caldav.fastmail.com
Authorization: Basic ...
Content-Type: text/calendar; charset=utf-8
If-None-Match: *
```

`If-None-Match: *` ensures a 412 Precondition Failed if an event with the same UID already exists (double-booking guard).

### Responses

| Status | Meaning |
|---|---|
| 201 Created | Success |
| 204 No Content | Success (event updated — shouldn't happen with `If-None-Match: *`) |
| 412 Precondition Failed | UID collision — regenerate UID and retry once |
| 4xx / 5xx | Propagate as 500 to client |

## Race Condition Handling

Between `GET /api/slots` and `POST /api/book`, another booking could take the slot.

Strategy:
1. Before writing, re-fetch busy intervals for the requested slot window.
2. If the slot is now blocked → return 409.
3. Otherwise PUT with `If-None-Match: *`.
4. If 412 → return 409 (UID collision treated as conflict).

This gives optimistic concurrency without distributed locks.

## Environment Variables

| Variable | Description |
|---|---|
| `CALDAV_USERNAME` | Fastmail username (e.g. `nils@ecke.lt`) |
| `CALDAV_PASSWORD` | App-specific password (CalDAV scope) |
| `CALDAV_CALENDAR_NILS` | Calendar path segment, default `Nils` |
| `CALDAV_CALENDAR_OHANA` | Calendar path segment, default `Ohana` |

## Test Cases (caldav.test.ts)

Tests mock `fetch` — no real network calls.

| Scenario | Expectation |
|---|---|
| REPORT returns 2 VEVENTs | parsed to 2 Intervals with correct start/end |
| VEVENT with TRANSP:TRANSPARENT | excluded from busy intervals |
| VEVENT with STATUS:CANCELLED | excluded |
| All-day event DATE format | blocks 00:00–24:00 of that day in UTC |
| DTEND missing, DURATION present | end = start + duration |
| PUT returns 201 | resolves with uid |
| PUT returns 412 | rejects with ConflictError |
| Re-check before PUT finds conflict | resolves with SlotUnavailableError before PUT |
