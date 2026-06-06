export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

export interface BookingRequest {
  start: string;
  duration: number;
  name: string;
  email: string;
  notes?: string;
}

export interface BookingResult {
  uid: string;
  start: string;
  end: string;
  jitsiUrl: string;
}

export interface Env {
  OWNER_NAME: string;
  OWNER_EMAIL: string;
  CALDAV_USERNAME: string;
  CALDAV_PASSWORD: string;
  CALDAV_CALENDAR_NILS: string;
  CALDAV_CALENDAR_OHANA: string;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
}

export class SlotUnavailableError extends Error {
  constructor() {
    super("slot no longer available");
    this.name = "SlotUnavailableError";
  }
}

export class ConflictError extends Error {
  constructor() {
    super("UID collision on CalDAV PUT");
    this.name = "ConflictError";
  }
}
