export interface Env {
  CALDAV_USERNAME: string;
  CALDAV_PASSWORD: string;
  CALDAV_CALENDAR_NILS: string;
  CALDAV_CALENDAR_OHANA: string;
  OWNER_NAME: string;
  OWNER_EMAIL: string;
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
  HOST_JOIN_SECRET?: string;
  // Cloudflare Workers AI binding for generating meeting titles. When unbound,
  // bookings fall back to a plain "Termin mit …" / "Meeting with …" title.
  AI?: AiBinding;
  RATE_LIMIT?: KVNamespace;
}

// Minimal shape of the Workers AI binding we use (text generation). With a
// json_schema response_format, `response` comes back as a parsed object;
// without it, as a string — the caller handles both.
export interface AiBinding {
  run(
    model: string,
    options: {
      messages: { role: string; content: string }[];
      max_tokens?: number;
      response_format?: unknown;
    },
  ): Promise<{ response?: unknown }>;
}

export class SlotUnavailableError extends Error {}
export class ConflictError extends Error {}

export interface Interval {
  start: Date;
  end: Date;
}

export interface BookingRequest {
  start: string;
  duration: number;
  name: string;
  email: string;
  notes: string;
  rescheduleUid?: string;
  lang: "de" | "en";
}

export interface BookingResult {
  uid: string;
  start: string;
  end: string;
  jitsiUrl: string;
}
