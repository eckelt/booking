import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/jitsi.js", async (orig) => ({
  ...(await orig<typeof import("../src/jitsi.js")>()),
  generateJitsiUrl: vi.fn(async (uid: string) => `https://8x8.vc/app/${uid}?jwt=x`),
}));
vi.mock("../src/email.js", () => ({ sendEmails: vi.fn(async () => {}) }));

import worker from "../src/index.js";
import { createBooking } from "../src/booking.js";
import { sendEmails } from "../src/email.js";
import { workingDayWindow } from "../src/availability.js";
import {
  UNSIGNED_LINK_GRACE_END,
  buildBookingLinks,
  isLinkAuthorized,
  ownerJoinUrl,
  signLinkToken,
  verifyLinkToken,
} from "../src/links.js";
import type { Env } from "../src/types.js";

const SECRET = "test-link-signing-secret";
const IN_GRACE = new Date("2026-10-31T22:59:59.999Z"); // 23:59:59.999 Berlin (CET)
const AFTER_GRACE = new Date("2026-10-31T23:00:00Z"); // 2026-11-01 00:00 Berlin

const baseEnv = {
  OWNER_NAME: "Nils Eckelt",
  OWNER_EMAIL: "nils@ecke.lt",
  CALDAV_USERNAME: "nils@ecke.lt",
  CALDAV_PASSWORD: "secret",
  CALDAV_CALENDAR_NILS: "Nils",
  CALDAV_CALENDAR_OHANA: "Ohana",
  SMTP_USERNAME: "nils@ecke.lt",
  SMTP_PASSWORD: "smtp-secret",
  JAAS_APP_ID: "app",
  JAAS_KEY_ID: "kid",
  JAAS_PRIVATE_KEY: "pem",
} as Env;
const env = { ...baseEnv, LINK_SIGNING_SECRET: SECRET } as Env;

const fakeCtx = {
  waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
} as unknown as ExecutionContext;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("link tokens", () => {
  it("signs base64url and verifies the same purpose + uid", async () => {
    const t = await signLinkToken(SECRET, "cancel", "abc-uid");
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyLinkToken(SECRET, "cancel", "abc-uid", t)).toBe(true);
  });

  it("rejects another uid, another purpose, another secret and garbage", async () => {
    const t = await signLinkToken(SECRET, "cancel", "abc-uid");
    expect(await verifyLinkToken(SECRET, "cancel", "other-uid", t)).toBe(false);
    expect(await verifyLinkToken(SECRET, "join", "abc-uid", t)).toBe(false);
    expect(await verifyLinkToken(SECRET, "reschedule", "abc-uid", t)).toBe(false);
    expect(await verifyLinkToken("other-secret", "cancel", "abc-uid", t)).toBe(false);
    expect(await verifyLinkToken(SECRET, "cancel", "abc-uid", "")).toBe(false);
    expect(await verifyLinkToken(SECRET, "cancel", "abc-uid", "!!notb64")).toBe(false);
    expect(await verifyLinkToken(SECRET, "cancel", "abc-uid", t.slice(0, -2))).toBe(false);
  });
});

describe("isLinkAuthorized — transition period and fail-closed", () => {
  it("grace end is 2026-11-01 00:00 Europe/Berlin", () => {
    expect(UNSIGNED_LINK_GRACE_END.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("accepts a missing t up to and including 2026-10-31 (Berlin), rejects it afterwards", async () => {
    expect(await isLinkAuthorized(env, "cancel", "u", null, IN_GRACE)).toBe(true);
    expect(await isLinkAuthorized(env, "cancel", "u", null, AFTER_GRACE)).toBe(false);
  });

  it("always rejects a wrong t, also during the transition period", async () => {
    expect(await isLinkAuthorized(env, "cancel", "u", "wrong", IN_GRACE)).toBe(false);
    expect(await isLinkAuthorized(env, "cancel", "u", "", IN_GRACE)).toBe(false);
  });

  it("accepts a valid t after the transition period", async () => {
    const t = await signLinkToken(SECRET, "join", "u");
    expect(await isLinkAuthorized(env, "join", "u", t, AFTER_GRACE)).toBe(true);
  });

  it("without LINK_SIGNING_SECRET: t is rejected, missing t only within the transition period", async () => {
    const t = await signLinkToken(SECRET, "cancel", "u");
    expect(await isLinkAuthorized(baseEnv, "cancel", "u", t, IN_GRACE)).toBe(false);
    expect(await isLinkAuthorized(baseEnv, "cancel", "u", null, IN_GRACE)).toBe(true);
    expect(await isLinkAuthorized(baseEnv, "cancel", "u", null, AFTER_GRACE)).toBe(false);
  });
});

describe("building links", () => {
  it("signs join, cancel and reschedule links with separate tokens", async () => {
    const links = await buildBookingLinks(env, "my-uid");
    const tJoin = new URL(links.joinUrl).searchParams.get("t")!;
    const tCancel = new URL(links.cancelUrl).searchParams.get("t")!;
    const tRes = new URL(links.rescheduleUrl).searchParams.get("t")!;
    expect(links.joinUrl.startsWith("https://join.ecke.lt/my-uid?t=")).toBe(true);
    expect(links.cancelUrl.startsWith("https://book.ecke.lt/api/cancel?uid=my-uid&t=")).toBe(true);
    expect(links.rescheduleUrl.startsWith("https://book.ecke.lt/?reschedule=my-uid&t=")).toBe(true);
    expect(await verifyLinkToken(SECRET, "join", "my-uid", tJoin)).toBe(true);
    expect(await verifyLinkToken(SECRET, "cancel", "my-uid", tCancel)).toBe(true);
    expect(await verifyLinkToken(SECRET, "reschedule", "my-uid", tRes)).toBe(true);
  });

  it("leaves links unsigned without a secret and warns without uid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const links = await buildBookingLinks(baseEnv, "secret-uid");
    expect(links.joinUrl).toBe("https://join.ecke.lt/secret-uid");
    expect(links.cancelUrl).toBe("https://book.ecke.lt/api/cancel?uid=secret-uid");
    expect(links.rescheduleUrl).toBe("https://book.ecke.lt/?reschedule=secret-uid");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toContain("secret-uid");
  });

  it("owner calendar link keeps ?host= and falls back to the signed join link", async () => {
    expect(await ownerJoinUrl({ ...env, HOST_JOIN_SECRET: "hs" } as Env, "u")).toBe("https://join.ecke.lt/u?host=hs");
    const signed = await ownerJoinUrl(env, "u");
    expect(await verifyLinkToken(SECRET, "join", "u", new URL(signed).searchParams.get("t")!)).toBe(true);
  });
});

function stubCalDav(uid: string, start: Date, end: Date) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:${uid}`,
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, "SUMMARY:Termin mit Waldemar",
    "DESCRIPTION:Notes: —\\nName: Waldemar\\nEmail: waldemar@example.com\\nBooked via book.ecke.lt",
    "ATTENDEE;CN=Waldemar;SCHEDULE-AGENT=NONE:mailto:waldemar@example.com",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "REPORT") return new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`, { status: 200 });
    if (method === "GET") return url.includes(`${uid}.ics`) ? new Response(ics, { status: 200 }) : new Response(null, { status: 404 });
    if (method === "PUT") return new Response(null, { status: 201 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bookableStart(): Date {
  for (let i = 2; i <= 12; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const w = workingDayWindow(d);
    if (w) return w.start;
  }
  throw new Error("no bookable weekday");
}

function deletes(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE").length;
}

describe("GET /api/cancel", () => {
  it("cancels with a valid t", async () => {
    const f = stubCalDav("u1", new Date(), new Date());
    const t = await signLinkToken(SECRET, "cancel", "u1");
    const res = await worker.fetch(new Request(`https://book.ecke.lt/api/cancel?uid=u1&t=${t}`), env, fakeCtx);
    expect(res.status).toBe(200);
    expect(deletes(f)).toBe(1);
  });

  it("403 with a wrong t (e.g. a join token) and does not delete", async () => {
    const f = stubCalDav("u1", new Date(), new Date());
    const t = await signLinkToken(SECRET, "join", "u1");
    const res = await worker.fetch(new Request(`https://book.ecke.lt/api/cancel?uid=u1&t=${t}`), env, fakeCtx);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Link ungültig oder abgelaufen");
    expect(deletes(f)).toBe(0);
  });

  it("without t: accepted during the transition period, 403 afterwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = stubCalDav("u1", new Date(), new Date());
    vi.setSystemTime(IN_GRACE);
    expect((await worker.fetch(new Request("https://book.ecke.lt/api/cancel?uid=u1"), env, fakeCtx)).status).toBe(200);
    vi.setSystemTime(AFTER_GRACE);
    expect((await worker.fetch(new Request("https://book.ecke.lt/api/cancel?uid=u1"), env, fakeCtx)).status).toBe(403);
    expect(deletes(f)).toBe(1);
  });

  it("fail-closed without LINK_SIGNING_SECRET when t is present", async () => {
    const f = stubCalDav("u1", new Date(), new Date());
    const t = await signLinkToken(SECRET, "cancel", "u1");
    const res = await worker.fetch(new Request(`https://book.ecke.lt/api/cancel?uid=u1&t=${t}`), baseEnv, fakeCtx);
    expect(res.status).toBe(403);
    expect(deletes(f)).toBe(0);
  });
});

describe("join.ecke.lt/<uid>", () => {
  it("redirects with a valid t", async () => {
    const t = await signLinkToken(SECRET, "join", "room-1");
    const res = await worker.fetch(new Request(`https://join.ecke.lt/room-1?t=${t}`), env, fakeCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://8x8.vc/app/room-1?jwt=x");
  });

  it("403 with a wrong t, also via /api/join", async () => {
    const t = await signLinkToken(SECRET, "cancel", "room-1");
    expect((await worker.fetch(new Request(`https://join.ecke.lt/room-1?t=${t}`), env, fakeCtx)).status).toBe(403);
    expect((await worker.fetch(new Request(`https://book.ecke.lt/api/join?uid=room-1&t=${t}`), env, fakeCtx)).status).toBe(403);
  });

  it("owner host link works without t even after the transition period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER_GRACE);
    const hostEnv = { ...env, HOST_JOIN_SECRET: "host-secret" } as Env;
    expect((await worker.fetch(new Request("https://join.ecke.lt/room-1?host=host-secret"), hostEnv, fakeCtx)).status).toBe(302);
    expect((await worker.fetch(new Request("https://join.ecke.lt/room-1?host=wrong"), hostEnv, fakeCtx)).status).toBe(403);
  });

  it("without t: accepted during the transition period, 403 afterwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(IN_GRACE);
    expect((await worker.fetch(new Request("https://join.ecke.lt/room-1"), env, fakeCtx)).status).toBe(302);
    vi.setSystemTime(AFTER_GRACE);
    expect((await worker.fetch(new Request("https://join.ecke.lt/room-1"), env, fakeCtx)).status).toBe(403);
  });
});

describe("reschedule", () => {
  it("/api/reschedule-info: 200 with valid t, 403 with wrong t", async () => {
    const s = bookableStart();
    stubCalDav("old-uid", s, new Date(s.getTime() + 30 * 60000));
    const t = await signLinkToken(SECRET, "reschedule", "old-uid");
    const ok = await worker.fetch(new Request(`https://book.ecke.lt/api/reschedule-info?uid=old-uid&t=${t}`), env, fakeCtx);
    expect(ok.status).toBe(200);
    const bad = await worker.fetch(new Request("https://book.ecke.lt/api/reschedule-info?uid=old-uid&t=nope"), env, fakeCtx);
    expect(bad.status).toBe(403);
  });

  it("POST /api/book with rescheduleUid: 403 with wrong t, 201 with valid t", async () => {
    const s = bookableStart();
    stubCalDav("old-uid", s, new Date(s.getTime() + 30 * 60000));
    const newStart = new Date(s.getTime() + 60 * 60000).toISOString();
    const body = JSON.stringify({ start: newStart, rescheduleUid: "old-uid", aiTitle: false });
    const post = (q: string) => worker.fetch(new Request(`https://book.ecke.lt/api/book${q}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }), env, fakeCtx);

    const bad = await post("?t=nope");
    expect(bad.status).toBe(403);
    const t = await signLinkToken(SECRET, "reschedule", "old-uid");
    const ok = await post(`?t=${t}`);
    expect(ok.status).toBe(201);
  });

  it("without t: rescheduling after the transition period is rejected", async () => {
    const s = bookableStart();
    stubCalDav("old-uid", s, new Date(s.getTime() + 30 * 60000));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER_GRACE);
    const res = await worker.fetch(new Request("https://book.ecke.lt/api/reschedule-info?uid=old-uid"), env, fakeCtx);
    expect(res.status).toBe(403);
  });
});

describe("createBooking — links in mails and calendar", () => {
  it("passes signed join, cancel and reschedule links to the confirmation mail and the booker's iCal", async () => {
    const s = bookableStart();
    stubCalDav("unused", s, s);
    const result = await createBooking(env, {
      start: s.toISOString(), duration: 30, name: "Waldemar", email: "waldemar@example.com",
      notes: "", lang: "de", aiTitle: false,
    }, fakeCtx);
    const p = vi.mocked(sendEmails).mock.calls.at(-1)![1];
    const uid = result.uid;
    const tOf = (u: string) => new URL(u).searchParams.get("t")!;
    expect(await verifyLinkToken(SECRET, "join", uid, tOf(p.jitsiUrl))).toBe(true);
    expect(await verifyLinkToken(SECRET, "cancel", uid, tOf(p.cancelUrl))).toBe(true);
    expect(await verifyLinkToken(SECRET, "reschedule", uid, tOf(p.rescheduleUrl))).toBe(true);
    expect(p.icalAttachment).toContain(`X-JITSI-URL:${p.jitsiUrl}`);
    expect(result.jitsiUrl).toBe(p.jitsiUrl);
  });
});
