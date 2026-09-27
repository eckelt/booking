# booking – Projektkontext

- **Produkt:** booking [landscape:inventory/raw/booking.yaml:1]
- **Repo:** git@github.com:eckelt/booking.git, Branch `main` [landscape:inventory/raw/booking.yaml:2-4]
- **Stand der Aussagen:** Commit `7877d39c9cf0bee4fc970b0c77edbd0fd97e6797` [landscape:inventory/raw/booking.yaml:3], aufgenommen am 2026-09-27
- **managed:** `oneshot` (einmalige Ist-Aufnahme von Hand, kein automatischer Abgleich)
- **Architektur-Manifest:** `twin.json` (Schema: ecke-lt-landscape `schema/twin.schema.json`, v3)

Alle Fundstellen `[datei:zeile]` beziehen sich auf den genannten Commit und sind relativ zum Repo-Root. Ausnahme: Aussagen und Requirements, die mit einem archivierten Change unter `openspec/changes/archive/` nachgezogen wurden (B13/B14 „signierte Links“), beziehen sich auf den Commit dieses Changes. `[landscape:…]` verweist auf das Repo ecke-lt-landscape. Konventionen: `landscape:CONVENTIONS.md`.
Werte aus `wrangler.toml` (Account-ID, Kalender-IDs, JaaS-App-ID) werden bewusst nicht wiedergegeben, nur die Namen.

## Capabilities

| Capability | Spec |
|---|---|
| booking-page | `openspec/specs/booking-page/spec.md` |
| booking-api | `openspec/specs/booking-api/spec.md` |
| availability | `openspec/specs/availability/spec.md` |
| calendar-caldav | `openspec/specs/calendar-caldav/spec.md` |
| email | `openspec/specs/email/spec.md` |
| video-meeting | `openspec/specs/video-meeting/spec.md` |
| feedback-form | `openspec/specs/feedback-form/spec.md` |
| deploy | `openspec/specs/deploy/spec.md` |

## Zweck

booking ist die Terminbuchung von Nils Eckelt unter book.ecke.lt: Besucher wählen 30 oder 60 Minuten und einen freien Zeitpunkt in den nächsten 14 Tagen und buchen mit Name und E-Mail [frontend/index.html:688-704; worker/src/booking.ts:10-11; worker/src/booking.ts:49-61].
Freie Zeiten werden aus zwei Fastmail-Kalendern berechnet, die Buchung landet als Termin im Kalender, und beide Seiten bekommen eine Bestätigung per E-Mail mit einem Videolink unter join.ecke.lt, der auf ein 8x8/JaaS-Meeting weiterleitet [worker/src/index.ts:182-185; worker/src/booking.ts:181; worker/src/booking.ts:208; worker/src/booking.ts:243-258; worker/src/index.ts:138-143].
Derselbe Worker betreibt außerdem unter feedback.ecke.lt ein kleines Feedbackformular für Workshops und Vorträge, dessen Antworten per E-Mail verschickt werden [worker/src/index.ts:55-65; worker/src/feedback.ts:6-11; worker/src/feedback.ts:182-188].

## Schnittstellen

### Angeboten

| Schnittstelle | Inhalt | contractRef | Beleg |
|---|---|---|---|
| Buchungsseite | `https://book.ecke.lt/`, `/30min`, `/60min` (Weiterleitung auf `/?duration=30|60`), Styles und Icons, Cloudflare Pages | `booking:booking-page@1` | [frontend/index.html:1-18; frontend/30min/index.html:5-11; frontend/60min/index.html:5-11; frontend/styles.css:2; landscape:inventory/raw/cloudflare.yaml:15-19] |
| Buchungs-API | `https://book.ecke.lt/api/` `slots`, `reschedule-info`, `book`, `cancel`, `join` (JSON bzw. HTML), Worker-Route `book.ecke.lt/api/*` | `booking:api@1` | [worker/src/index.ts:71-90; wrangler.toml:34-36] |
| Meeting-Link | `https://join.ecke.lt/<uid>` → 302 auf 8x8.vc, Worker-Route `join.ecke.lt/*` | `booking:join@1` | [worker/src/index.ts:84-89; worker/src/index.ts:122-143; wrangler.toml:38-40] |
| Feedbackformular | `https://feedback.ecke.lt/`, `/<slug>`, `POST /api/feedback`, Worker-Route `feedback.ecke.lt/*` | `booking:feedback-form@1` | [worker/src/feedback.ts:128-153; wrangler.toml:42-46] |

Bekannter Nutzer: nils.ecke.lt verlinkt auf die Buchungsseite `https://book.ecke.lt/30min` [landscape:inventory/raw/nils.ecke.lt.yaml:61-63]. Die Buchungs-API nutzt nur das eigene Frontend (CORS nur für `https://book.ecke.lt`) [worker/src/index.ts:9-13; frontend/index.html:738].

### Genutzt

| Schnittstelle | Anbieter | contractRef | Beleg |
|---|---|---|---|
| Stylesheet `https://ecke-design-system.pages.dev/v1/styles.css` (per `@import`) | ecke-design-system | `ecke-design-system:styles@1` | [frontend/styles.css:1-2] |
| Webfonts `https://nils.ecke.lt/fonts/*.woff2` (Statusseiten des Workers) | nils.ecke.lt | `nils.ecke.lt:fonts@1` | [worker/src/index.ts:15-17] |
| Links auf `https://nils.ecke.lt/`, `/impressum/`, `/datenschutz/` | nils.ecke.lt | `nils.ecke.lt:site@1` | [frontend/index.html:681; frontend/index.html:787; frontend/index.html:1642-1644] |
| CalDAV `https://caldav.fastmail.com/dav/calendars/user/…` (REPORT, GET, PUT, DELETE, Basic Auth) | Fastmail (Kalender) | `fastmail-caldav:caldav@1` | [worker/src/caldav.ts:4-12; worker/src/caldav.ts:26-34; worker/src/caldav.ts:51-54; worker/src/caldav.ts:69-81; worker/src/caldav.ts:99-103] |
| SMTP `smtp.fastmail.com:465` (TLS, AUTH PLAIN) | Fastmail (Mailversand) | `fastmail-smtp:smtp@1` | [worker/src/email.ts:227-229; worker/src/email.ts:282-284] |
| Meeting `https://8x8.vc/<appId>/<uid>?jwt=…` (RS256-JWT) | 8x8 JaaS | `jaas:meeting@1` | [worker/src/jitsi.ts:10-21; worker/src/jitsi.ts:36-65] |
| `POST https://api.anthropic.com/v1/messages` (Modell `claude-haiku-4-5`) | Anthropic | `anthropic-api:messages@1` | [worker/src/title.ts:6; worker/src/title.ts:86-105] |
| Laufzeit des Workers (Routen, `cloudflare:sockets`, Workers Logs) | Cloudflare Workers | `cloudflare-workers:runtime@1` | [wrangler.toml:1-12; wrangler.toml:34-46; worker/src/email.ts:228] |
| Hosting der statischen Dateien (Projekt `booking`) | Cloudflare Pages | `cloudflare-pages:hosting@1` | [Makefile:15-16; landscape:inventory/raw/cloudflare.yaml:15-19] |
| Worker-Deploy (`wrangler deploy`) | Cloudflare Workers | `cloudflare-workers:deploy-api@1` | [.github/workflows/deploy.yml:19-31] |
| Pages-Deploy (`wrangler pages deploy`) | Cloudflare Pages | `cloudflare-pages:deploy-api@1` | [.github/workflows/deploy.yml:33-45] |
| CI-Runner `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` | GitHub Actions | `github-actions:workflows@1` | [.github/workflows/deploy.yml:8-17] |

Intern (gleiches Produkt): Das Frontend ruft die Buchungs-API auf (`booking:api@1`) [frontend/index.html:738; frontend/index.html:1182-1183; frontend/index.html:1446]; das Feedbackformular lädt `styles.css` und Icons von book.ecke.lt (`booking:booking-page@1`) [worker/src/feedback-page.ts:184-187].

## Datenflüsse

1. **Seitenabruf:** Der Browser lädt HTML, Icons und `styles.css` vom Pages-Projekt `booking` unter book.ecke.lt; `styles.css` lädt das Design-System von `ecke-design-system.pages.dev` [frontend/index.html:6-18; frontend/styles.css:2; landscape:inventory/raw/cloudflare.yaml:15-19; landscape:inventory/raw/cloudflare.yaml:104].
2. **Freie Zeiten:** Frontend → `GET /api/slots` → Worker fragt per CalDAV-REPORT die Kalender `CALDAV_CALENDAR_NILS` und `CALDAV_CALENDAR_OHANA` bei Fastmail ab und berechnet daraus Slots [frontend/index.html:1202-1203; worker/src/index.ts:180-190; worker/src/index.ts:205-229].
3. **Buchung:** Frontend → `POST /api/book` mit Start, Dauer, Name, E-Mail, Notiz, Sprache und `aiTitle` → Worker schickt Name und Notiz an die Anthropic-API (falls Notiz, Schlüssel und `aiTitle` vorhanden), prüft den Slot erneut per CalDAV und schreibt den Termin per CalDAV-PUT in den Kalender `CALDAV_CALENDAR_NILS` [frontend/index.html:1446-1459; worker/src/booking.ts:118-151; worker/src/booking.ts:181; worker/src/booking.ts:208; worker/src/title.ts:35; worker/src/title.ts:100].
4. **Bestätigung:** Nach der Buchung verschickt der Worker im Hintergrund (`ctx.waitUntil`) per SMTP über Fastmail eine Bestätigung an den Bucher (mit `.ics`) und eine Benachrichtigung an `OWNER_EMAIL` [worker/src/booking.ts:230-258; worker/src/email.ts:22-26].
5. **Meeting:** Aufruf von `join.ecke.lt/<uid>?t=<token>` → Worker prüft das signierte Link-Token (Secret `LINK_SIGNING_SECRET`), signiert ein JaaS-JWT mit `JAAS_PRIVATE_KEY` und leitet per 302 auf `8x8.vc` weiter; mit `?host=<HOST_JOIN_SECRET>` als Moderator [worker/src/index.ts:146-162; worker/src/links.ts:75-88; worker/src/jitsi.ts:19-20].
6. **Storno/Umbuchung:** `GET /api/cancel?uid=&t=` löscht den Termin per CalDAV-DELETE; `/?reschedule=<uid>&t=` holt die Dauer über `/api/reschedule-info` und verschiebt den Termin per PUT mit Überschreiben; das Token `t` wird jeweils geprüft [worker/src/index.ts:310-339; worker/src/index.ts:254-268; worker/src/index.ts:290-294; worker/src/booking.ts:161-182; frontend/index.html:1621-1636].
7. **Feedback:** `POST feedback.ecke.lt/api/feedback` → Worker verschickt die Antwort per SMTP an `FEEDBACK_EMAIL` (sonst `OWNER_EMAIL`); keine Datenbank [worker/src/feedback.ts:155-188; worker/src/feedback.ts:120-125].
8. **Browser-Speicher:** Sprache, Name, E-Mail, Notiz und die KI-Titel-Wahl werden im `localStorage` gehalten [frontend/index.html:940; frontend/index.html:1356-1357; frontend/index.html:1390-1397; frontend/index.html:1409].
9. **Deploy:** Jeder Push auf `main` → GitHub Actions führt `npm test` aus → danach parallel `wrangler deploy` (Worker `booking-worker`) und `wrangler pages deploy frontend/ --project-name booking --branch main`, beides mit dem GitHub-Secret `CLOUDFLARE_API_TOKEN`; es gibt keinen Pfadfilter [.github/workflows/deploy.yml:1-45; landscape:landscape.yaml:40-44]. Cloudflare selbst hat keine Git-Integration für Worker oder Pages [landscape:inventory/raw/cloudflare.yaml:44; landscape:inventory/raw/cloudflare.yaml:157].

## Abhängigkeiten

### Intern

| Produkt | Art | Beleg |
|---|---|---|
| ecke-design-system | Library; `v1/styles.css` zur Laufzeit per `@import` | [frontend/styles.css:2; landscape:inventory/raw/booking.yaml:158-160] |
| nils.ecke.lt | Webfonts für die Statusseiten des Workers; Links auf Profil, Impressum, Datenschutz | [worker/src/index.ts:15-17; frontend/index.html:681; frontend/index.html:1642-1644; landscape:inventory/raw/booking.yaml:151-157] |

Laufzeit-Konfiguration des Workers (nur Namen): Variablen `OWNER_NAME`, `OWNER_EMAIL`, `FEEDBACK_EMAIL`, `CALDAV_CALENDAR_NILS`, `CALDAV_CALENDAR_OHANA`, `JAAS_APP_ID`, `JAAS_KEY_ID`, `OWNER_TZ`, `OWNER_MIN_HOUR`, `OWNER_MAX_HOUR` [wrangler.toml:14-29]; Secrets `CALDAV_USERNAME`, `CALDAV_PASSWORD`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `JAAS_PRIVATE_KEY`, `HOST_JOIN_SECRET`, `ANTHROPIC_API_KEY` [worker/src/types.ts:1-25; landscape:inventory/raw/cloudflare.yaml:45-52] und seit B13/B14 `LINK_SIGNING_SECRET` [worker/src/types.ts:21-24; wrangler.toml:31-33]; optionales KV-Binding `RATE_LIMIT`, das nicht gebunden ist [worker/src/types.ts:25; landscape:inventory/raw/cloudflare.yaml:64]. Kompatibilitätsflag `nodejs_compat`, Workers Logs mit Sampling 1 [wrangler.toml:4-12].

### Extern

| Anbieter | Rolle | Beleg |
|---|---|---|
| Fastmail (CalDAV) | Kalender lesen und schreiben | [worker/src/caldav.ts:4] |
| Fastmail (SMTP) | Mailversand für Buchung und Feedback | [worker/src/email.ts:229; worker/src/feedback.ts:183] |
| 8x8 JaaS | Videomeeting | [worker/src/jitsi.ts:20; landscape:inventory/overlay.yaml:129-135] |
| Anthropic | Meeting-Titel und Link-Slugs | [worker/src/title.ts:6; worker/src/title.ts:86] |
| Cloudflare Workers | Laufzeit `booking-worker`, Routen `book.ecke.lt/api/*`, `join.ecke.lt/*`, `feedback.ecke.lt/*` | [wrangler.toml:1; wrangler.toml:34-46; landscape:inventory/raw/cloudflare.yaml:40-44] |
| Cloudflare Pages | Hosting Frontend, Projekt `booking`, Custom Domain book.ecke.lt | [Makefile:15-16; landscape:inventory/raw/cloudflare.yaml:15-19] |
| GitHub (Actions) | Repo und CI | [.github/workflows/deploy.yml:1-45] |

Build-Werkzeuge (dev): `wrangler`, `typescript`, `vitest`, `@cloudflare/workers-types` [worker/package.json:12-17].

## Bekannte Lücken

- **Rate-Limiting inaktiv (C4 → B3):** Der Code prüft Limits nur, wenn `RATE_LIMIT` gebunden ist; das Binding fehlt in `wrangler.toml` und live [worker/src/index.ts:105; wrangler.toml:31-32; landscape:inventory/raw/cloudflare.yaml:64; landscape:inventory/overlay.yaml:136-144].
- **Veraltete Doku zu Jitsi (C3 → B5, B6):** `docs/spec-*.md` und eine Test-Fixture nennen meet.jit.si, der Code nutzt 8x8/JaaS [landscape:inventory/overlay.yaml:128-135; landscape:backlog.md:12-13].
- **`HOST_JOIN_SECRET` nicht dokumentiert (C5 → B7):** Das Secret ist live gesetzt, steht aber weder in `wrangler.toml` noch in `STATUS.md` [worker/src/types.ts:21; landscape:inventory/overlay.yaml:145-154; landscape:backlog.md:14].
- **`STATUS.md` widerspricht dem Code:** Dort heißt es, der Mailversand sei offen, der Code nutze MailChannels und die SMTP-Secrets seien überflüssig; der Code verschickt per SMTP über Fastmail. Auch die „nächsten Schritte“ (60-Minuten-Seite anlegen) sind schon erledigt [STATUS.md:20-22; STATUS.md:37-38; STATUS.md:89-90; worker/src/email.ts:227-229; frontend/60min/index.html:7].
- **Übergangsfrist für unsignierte Links (B13/B14):** Storno, Umbuchung und Meeting-Beitritt brauchen ein signiertes Token `t`; Links ohne `t` (aus vor B13/B14 verschickten Mails und Kalendern) werden noch bis einschließlich 2026-10-31 (Europe/Berlin) akzeptiert. Danach die Konstante `UNSIGNED_LINK_GRACE_END` und ihren Zweig entfernen. Ohne gesetztes `LINK_SIGNING_SECRET` gehen Links unsigniert raus und funktionieren nach der Frist nicht mehr [worker/src/links.ts:12-17; worker/src/links.ts:75-88; worker/src/links.ts:103-107].
- **Owner-Zeitzone nur in der Anzeige:** `/api/slots` begrenzt Slots auf `OWNER_TZ`/`OWNER_MIN_HOUR`/`OWNER_MAX_HOUR`, `/api/book` prüft nur das Berliner Arbeitsfenster [worker/src/index.ts:165-169; worker/src/index.ts:210; worker/src/booking.ts:142].
- **Sprache:** Das Frontend hat auch spanische Texte, aber nur DE/EN-Schalter; an die API geht nur `de` oder `en`. Die Bestätigungsmail an den Bucher ist immer englisch [frontend/index.html:850; frontend/index.html:683-686; frontend/index.html:1452-1455; worker/src/email.ts:96-143].
- **Personenbezogene Daten in Logs:** Bei Mailfehlern landen uid und Empfängeradresse im Log, Workers Logs sind mit Sampling 1 aktiv [worker/src/booking.ts:257; wrangler.toml:10-12].
- **Jeder Push deployt:** Auch reine Doku- oder Spec-Commits lösen Tests und Deploy von Worker und Pages aus [.github/workflows/deploy.yml:3-5; landscape:landscape.yaml:44].

## Offene Fragen

- Sind die laut `STATUS.md` versehentlich im Pages-Projekt gesetzten Secrets (`CALDAV_*`, `SMTP_*`) noch vorhanden? Die Inventur hat nur den Worker geprüft.
- Wozu dienen `frontend/tokens/*.css` und `frontend/fonts/*.woff2`? Keine Seite im Repo verweist darauf; sie werden aber mit ausgeliefert.
- Welche Rechte haben `CLOUDFLARE_API_TOKEN`, das Fastmail-App-Passwort für CalDAV und das für SMTP, und wer rotiert sie?
- Ist `feedback.ecke.lt` Teil von booking oder ein eigenes Produkt, das nur im selben Worker läuft? Hier ist es als Capability von booking erfasst.
- Ist gewollt, dass die uid (und damit Storno/Umbuchung/Meeting-Link) aus Name oder Notiz ableitbar ist?
- Deckt die Datenschutzerklärung von nils.ecke.lt die Weitergabe von Name und Notiz an Anthropic ab? Das ist hier nicht geprüft.
- Welche Werte gelten für `CALDAV_CALENDAR_OHANA` fachlich (wessen Kalender)? Der Code nutzt ihn nur als zweite Belegt-Quelle.
