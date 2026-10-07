import type { Env } from "./types.js";
import { ConflictError } from "./types.js";
import { getEventRaw, putEventRaw, parseOwnEvent, readStoredVideo, setStoredVideo } from "./caldav.js";

// Which video service join.ecke.lt/<uid> sends people to. Switched with the
// VIDEO_PROVIDER var (wrangler.toml or the Cloudflare dashboard); a single
// link can be forced with ?via=jitsi|google|teams.
//
// google/teams meetings are created lazily on the first click of the join
// link and remembered on the calendar event (X-VIDEO-URL), so the booking
// link itself never changes and the switch also applies to bookings made
// before it. Whenever that can't happen (credentials missing, API down, the
// uid isn't one of our events) the join falls back to Jitsi.
export type VideoProvider = "google" | "teams" | "jitsi";

const PROVIDERS: readonly VideoProvider[] = ["google", "teams", "jitsi"];
const DEFAULT_PROVIDER: VideoProvider = "google";
const API_TIMEOUT_MS = 8000;

export function pickVideoProvider(env: Env, override?: string | null): VideoProvider {
  const wanted = (override || env.VIDEO_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  return (PROVIDERS as readonly string[]).includes(wanted) ? (wanted as VideoProvider) : DEFAULT_PROVIDER;
}

export function isConfigured(env: Env, provider: VideoProvider): boolean {
  if (provider === "google") {
    return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
  }
  if (provider === "teams") return !!(env.MS_CLIENT_ID && env.MS_REFRESH_TOKEN);
  return true;
}

// The meeting URL to redirect to for this booking, or null when the caller
// should fall back to Jitsi (unknown uid — e.g. an ad-hoc join.ecke.lt room).
export async function resolveMeetingUrl(
  env: Env,
  uid: string,
  provider: Exclude<VideoProvider, "jitsi">,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  const raw = await getEventRaw(env, uid, fetcher);
  if (!raw) return null;

  const stored = readStoredVideo(raw.ical);
  if (stored?.provider === provider) return stored.url;

  const event = parseOwnEvent(raw.ical);
  if (!event) return null;

  const url = provider === "google"
    ? await createGoogleMeet(env, fetcher)
    : await createTeamsMeeting(env, { title: event.title, start: event.start, end: event.end }, fetcher);

  try {
    await putEventRaw(env, uid, setStoredVideo(raw.ical, { provider, url }), raw.etag, fetcher);
  } catch (err) {
    // Two people clicked at once and the other one stored their meeting
    // first — go where they went so nobody ends up alone.
    if (err instanceof ConflictError) {
      const again = await getEventRaw(env, uid, fetcher);
      const winner = again ? readStoredVideo(again.ical) : null;
      if (winner?.provider === provider) return winner.url;
    }
    // Otherwise still hand out the fresh meeting; the next click just
    // creates (and hopefully stores) another one.
    console.error(`[video] could not store ${provider} link uid=${uid} error=${(err as Error)?.message ?? err}`);
  }
  return url;
}

// ── Google Meet (Meet REST API, OAuth refresh token of the owner's account) ──

async function createGoogleMeet(env: Env, fetcher: typeof fetch): Promise<string> {
  const token = await accessToken("google", fetcher, () => ({
    url: "https://oauth2.googleapis.com/token",
    body: {
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    },
  }));

  // OPEN: the guest joins straight away instead of knocking and waiting to be
  // admitted — the same as with Jitsi. Retried with Meet's defaults in case the
  // account doesn't allow that setting.
  let res = await createSpace(token, { config: { accessType: "OPEN" } }, fetcher);
  if (res.status === 400 || res.status === 403) {
    console.error(`[video] Meet refused accessType=OPEN (${res.status}), retrying with defaults`);
    res = await createSpace(token, {}, fetcher);
  }
  if (!res.ok) throw new Error(`Meet spaces.create failed: ${res.status} ${await errorBody(res)}`);
  const data = (await res.json()) as { meetingUri?: string };
  if (!data.meetingUri) throw new Error("Meet spaces.create returned no meetingUri");
  return data.meetingUri;
}

function createSpace(token: string, body: unknown, fetcher: typeof fetch): Promise<Response> {
  return fetcher("https://meet.googleapis.com/v2/spaces", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

// ── Microsoft Teams (Graph onlineMeetings, needs a work/school M365 account) ──

async function createTeamsMeeting(
  env: Env,
  event: { title: string; start: Date; end: Date },
  fetcher: typeof fetch
): Promise<string> {
  const tenant = env.MS_TENANT_ID || "common";
  const token = await accessToken("teams", fetcher, () => ({
    url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    body: {
      client_id: env.MS_CLIENT_ID!,
      ...(env.MS_CLIENT_SECRET ? { client_secret: env.MS_CLIENT_SECRET } : {}),
      refresh_token: env.MS_REFRESH_TOKEN!,
      grant_type: "refresh_token",
      scope: "OnlineMeetings.ReadWrite offline_access",
    },
  }));

  const res = await fetcher("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: event.title || "Meeting",
      startDateTime: event.start.toISOString(),
      endDateTime: event.end.toISOString(),
      // Let the guest in without waiting in the lobby, as with Jitsi/Meet.
      lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true },
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Graph onlineMeetings failed: ${res.status} ${await errorBody(res)}`);
  const data = (await res.json()) as { joinWebUrl?: string };
  if (!data.joinWebUrl) throw new Error("Graph onlineMeetings returned no joinWebUrl");
  return data.joinWebUrl;
}

// ── OAuth access tokens, cached per worker isolate until shortly before expiry ──

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

async function accessToken(
  key: string,
  fetcher: typeof fetch,
  request: () => { url: string; body: Record<string, string> }
): Promise<string> {
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { url, body } = request();
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${key} token refresh failed: ${res.status} ${await errorBody(res)}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`${key} token refresh returned no access_token`);
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 120) * 1000,
  });
  return data.access_token;
}

async function errorBody(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 300);
}
