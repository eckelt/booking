# Video providers (Google Meet / Teams / Jitsi)

Booking links stay `https://join.ecke.lt/<uid>`. What they lead to is decided
**when someone clicks**, by the `VIDEO_PROVIDER` var in `wrangler.toml`:

| Value | What happens on join |
|---|---|
| `google` (default) | Creates a Google Meet on first click, stores it on the calendar event (`X-VIDEO-URL`), redirects both people there |
| `teams` | Same, with a Teams meeting (needs a **work/school** Microsoft 365 account) |
| `jitsi` | Old behaviour: JaaS / 8x8 with JWT, `?host=` for moderator |

- Switch = edit `VIDEO_PROVIDER` in `wrangler.toml` and push to `main`. It also
  applies to bookings made before the switch (the link doesn't change).
- **Fallback:** credentials missing, API error, token expired or a uid that
  isn't a booking → Jitsi, so a join link never dead-ends. Failures are logged
  (`[video] …` in Workers Logs).
- **Emergency override for a single call:** `https://join.ecke.lt/<uid>?via=jitsi`
  (or `?via=google` / `?via=teams`).
- A reschedule keeps the already-created meeting.
- For Meet/Teams you are host because the meeting is created with your account:
  just be signed in to that account in the browser. The `?host=` secret only
  matters for Jitsi.

## Google Meet setup (once, ~10 min)

1. <https://console.cloud.google.com/> → sign in as `nilseckelt@googlemail.com`
   → create a project (e.g. `book-ecke-lt`).
2. **APIs & Services → Library** → enable **Google Meet REST API**.
3. **Google Auth Platform / OAuth consent screen**: User type *External*, app
   name `book.ecke.lt`, add yourself as test user, add scope
   `https://www.googleapis.com/auth/meetings.space.created`.
   Then **Audience → Publish app** (status *In production*). This matters:
   in *Testing* status Google expires refresh tokens after 7 days. Verification
   is not needed for your own account — you just click through the
   "unverified app" warning once.
4. **Clients → Create client → Desktop app**. Note client ID + secret.
5. Get the refresh token (locally, needs Node ≥ 18):
   ```sh
   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/oauth-google.mjs
   ```
   Open the printed URL, sign in, allow.
6. Store the three secrets on the worker:
   ```sh
   cd worker
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_REFRESH_TOKEN
   ```
7. Test: book a slot, click the join link → `meet.google.com/…`.

Meet spaces are created with `accessType: OPEN`, so the guest joins without
knocking (like Jitsi). Personal Google accounts: 1:1 calls have no time limit;
calls with 3+ people are capped at 60 min.

## Microsoft Teams setup (only with a Microsoft 365 business account)

Graph can only create Teams meetings for **work/school** accounts. If
`nils@ecke.lt` is a personal Microsoft account (outlook.com-style login with
your own address), this won't work — stick with Google.

1. <https://entra.microsoft.com> → **App registrations → New registration**,
   name `book.ecke.lt`, account type *single tenant*, redirect URI platform
   *Public client/native (mobile & desktop)*: `http://localhost:8765/callback`.
2. **API permissions → Microsoft Graph → Delegated**: `OnlineMeetings.ReadWrite`,
   `offline_access` → *Grant admin consent*.
3. Note the *Application (client) ID* and *Directory (tenant) ID*.
4. ```sh
   MS_CLIENT_ID=… MS_TENANT_ID=… node scripts/oauth-microsoft.mjs
   cd worker
   npx wrangler secret put MS_CLIENT_ID
   npx wrangler secret put MS_TENANT_ID
   npx wrangler secret put MS_REFRESH_TOKEN
   ```
   (`MS_CLIENT_SECRET` only if you registered a *Web* platform with a secret.)
5. Set `VIDEO_PROVIDER = "teams"` in `wrangler.toml` and push.

Caveat: Microsoft refresh tokens can expire (typically after 90 days) and the
worker doesn't persist the rotated tokens Microsoft hands back. If Teams
links start falling back to Jitsi, re-run step 4.
