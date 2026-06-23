export interface Env {
  CALDAV_USERNAME: string;
  CALDAV_PASSWORD: string;
  CALDAV_CALENDAR_NILS: string;
  CALDAV_CALENDAR_OHANA: string;
  OWNER_NAME: string;
  OWNER_EMAIL: string;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  JAAS_APP_ID: string;
  JAAS_KEY_ID: string;
  JAAS_PRIVATE_KEY: string;
  RATE_LIMIT?: KVNamespace;
}

export class SlotUnavailableError extends Error {}
export class ConflictError extends Error {}

export interface Interval {
  start: Date;
  end: Date;
}
