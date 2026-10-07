export interface Env {
  CALDAV_USERNAME: string;
  CALDAV_PASSWORD: string;
  CALDAV_CALENDAR_NILS: string;
  CALDAV_CALENDAR_OHANA: string;
  OWNER_NAME: string;
  OWNER_EMAIL: string;
  // Where feedback.ecke.lt submissions are mailed. Falls back to OWNER_EMAIL.
  FEEDBACK_EMAIL?: string;
  // Owner's current timezone + waking-hour bounds. Defaults to Europe/Berlin
  // (9–17), i.e. no extra restriction. Set OWNER_TZ when travelling so slots
  // never fall outside the owner's own hours.
  OWNER_TZ?: string;
  OWNER_MIN_HOUR?: string;
  OWNER_MAX_HOUR?: string;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  JAAS_APP_ID: string;
  JAAS_KEY_ID: string;
  JAAS_PRIVATE_KEY: string;
  // Video service behind join.ecke.lt: "google" (default), "teams" or "jitsi".
  // Falls back to Jitsi whenever the chosen one isn't configured or fails.
  VIDEO_PROVIDER?: string;
  // Google Meet: OAuth client + refresh token of the owner's Google account
  // (scope meetings.space.created). See scripts/oauth-google.mjs.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  // Microsoft Teams: Entra app + refresh token (OnlineMeetings.ReadWrite) of a
  // work/school M365 account. See scripts/oauth-microsoft.mjs.
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_REFRESH_TOKEN?: string;
  MS_TENANT_ID?: string;
  HOST_JOIN_SECRET?: string;
  // HMAC key for the signed booking links (cancel, reschedule, join; query
  // parameter `t`). Worker secret; see links.ts.
  LINK_SIGNING_SECRET?: string;
  // Anthropic API key for generating meeting titles (Claude Haiku). When unset,
  // bookings fall back to a plain "Termin mit …" / "Meeting with …" title.
  ANTHROPIC_API_KEY?: string;
  RATE_LIMIT?: KVNamespace;
}

export class SlotUnavailableError extends Error {}
export class ConflictError extends Error {}
// A reschedule link's uid no longer resolves to a real event (already
// cancelled/gone) AND the request didn't carry enough of its own
// duration/name/email to fall back to a fresh booking.
export class RescheduleTargetGoneError extends Error {}

export interface Interval {
  start: Date;
  end: Date;
  // The source event's CalDAV UID, when known. Lets a reschedule exclude its
  // own old slot from the busy check by identity instead of by comparing
  // timestamps parsed through two different code paths (GET vs REPORT).
  uid?: string;
}

export interface BookingRequest {
  start: string;
  // 0 when omitted — a true reschedule derives it from the event being
  // moved instead. Required (and validated as 30|60) for a fresh booking.
  duration: number;
  // "" when omitted — a true reschedule derives it from the event being
  // moved instead. Required for a fresh booking.
  name: string;
  email: string;
  notes: string;
  rescheduleUid?: string;
  lang: "de" | "en";
  // Booker's opt-out of AI title generation (default true). false skips the
  // model call entirely and uses the plain "Termin mit …" fallback title.
  aiTitle: boolean;
}

export interface BookingResult {
  uid: string;
  start: string;
  end: string;
  jitsiUrl: string;
}
