import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index.js";
import { pickVideoProvider, clearTokenCache } from "../src/video.js";
import { buildIcal, parseOwnEvent, readStoredVideo, setStoredVideo } from "../src/caldav.js";
import type { Env } from "../src/types.js";

const baseEnv = {
  OWNER_NAME: "Nils Eckelt",
  OWNER_EMAIL: "nils@ecke.lt",
  CALDAV_USERNAME: "nils@ecke.lt",
  CALDAV_PASSWORD: "secret",
  CALDAV_CALENDAR_NILS: "Nils",
  CALDAV_CALENDAR_OHANA: "Ohana",
  JAAS_APP_ID: "vpaas-magic-cookie-test",
  JAAS_KEY_ID: "testkey",
  JAAS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
} as Env;

const googleEnv = {
  ...baseEnv,
  VIDEO_PROVIDER: "google",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  GOOGLE_REFRESH_TOKEN: "grefresh",
} as Env;

const teamsEnv = {
  ...baseEnv,
  VIDEO_PROVIDER: "teams",
  MS_CLIENT_ID: "mid",
  MS_CLIENT_SECRET: "msecret",
  MS_REFRESH_TOKEN: "mrefresh",
  MS_TENANT_ID: "tenant-1",
} as Env;

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

function eventIcs(extra: string[] = []): string {
  return buildIcal({
    uid: "radtour",
    start: new Date("2026-10-01T08:00:00Z"),
    end: new Date("2026-10-01T08:30:00Z"),
    title: "Radtour am See",
    name: "Horst",
    notes: "",
    jitsiUrl: "https://join.ecke.lt/radtour",
    ownerEmail: "nils@ecke.lt",
    ownerName: "Nils Eckelt",
    bookerEmail: "horst@example.com",
  }).replace("BEGIN:VALARM", [...extra, "BEGIN:VALARM"].join("\r\n"));
}

type Call = { url: string; init: RequestInit };

// Routes fetches by "METHOD url"; records every call so tests can assert on them.
function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const method = (init.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch ${method} ${url}`);
    return handler(init);
  });
  return { fn, calls };
}

const EVENT_URL = "https://caldav.fastmail.com/dav/calendars/user/nils@ecke.lt/Nils/radtour.ics";

function join(env: Env, query = "") {
  return worker.fetch(new Request(`https://join.ecke.lt/radtour${query}`), env, ctx);
}

describe("pickVideoProvider", () => {
  it("defaults to google", () => {
    expect(pickVideoProvider(baseEnv)).toBe("google");
  });
  it("follows VIDEO_PROVIDER, case-insensitively", () => {
    expect(pickVideoProvider({ ...baseEnv, VIDEO_PROVIDER: " Teams " } as Env)).toBe("teams");
    expect(pickVideoProvider({ ...baseEnv, VIDEO_PROVIDER: "jitsi" } as Env)).toBe("jitsi");
  });
  it("lets ?via= override the setting", () => {
    expect(pickVideoProvider(googleEnv, "jitsi")).toBe("jitsi");
  });
  it("treats unknown values as the default", () => {
    expect(pickVideoProvider({ ...baseEnv, VIDEO_PROVIDER: "zoom" } as Env)).toBe("google");
  });
});

describe("stored meeting link on the event", () => {
  it("round-trips through setStoredVideo/readStoredVideo and sits before the VALARM", () => {
    const ics = setStoredVideo(eventIcs(), { provider: "google", url: "https://meet.google.com/abc-defg-hij" });
    expect(readStoredVideo(ics)).toEqual({ provider: "google", url: "https://meet.google.com/abc-defg-hij" });
    expect(ics.indexOf("X-VIDEO-URL")).toBeLessThan(ics.indexOf("BEGIN:VALARM"));
    // Replacing keeps a single line.
    const again = setStoredVideo(ics, { provider: "teams", url: "https://teams.microsoft.com/l/x" });
    expect(again.match(/X-VIDEO-URL/g)).toHaveLength(1);
    expect(readStoredVideo(again)?.provider).toBe("teams");
    expect(parseOwnEvent(again)?.title).toBe("Radtour am See");
  });

  it("reads a folded (long) line as the server may return it", () => {
    const url = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_" + "x".repeat(120);
    const line = `X-VIDEO-URL;X-PROVIDER=teams:${url}`;
    const folded = line.slice(0, 75) + "\r\n " + line.slice(75);
    expect(readStoredVideo(eventIcs([folded]))?.url).toBe(url);
  });

  it("buildIcal keeps a video passed in (reschedule)", () => {
    const ics = buildIcal({
      uid: "u", start: new Date(), end: new Date(Date.now() + 1800000), title: "T", name: "N", notes: "",
      jitsiUrl: "https://join.ecke.lt/u", ownerEmail: "o@x.de", ownerName: "O", bookerEmail: "b@x.de",
      video: { provider: "google", url: "https://meet.google.com/aaa-bbbb-ccc" },
    });
    expect(parseOwnEvent(ics)?.video).toEqual({ provider: "google", url: "https://meet.google.com/aaa-bbbb-ccc" });
  });
});

describe("join.ecke.lt with a video provider", () => {
  beforeEach(() => {
    clearTokenCache();
    // Jitsi fallback signs a JWT — stub the crypto so the fake key works.
    vi.stubGlobal("crypto", {
      randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto),
      subtle: {
        importKey: vi.fn().mockResolvedValue({} as CryptoKey),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a Meet space on first join, stores it on the event and redirects there", async () => {
    let stored = "";
    const { fn, calls } = fakeFetch({
      [`GET ${EVENT_URL}`]: () => new Response(eventIcs(), { headers: { ETag: '"v1"' } }),
      "POST https://oauth2.googleapis.com/token": () => Response.json({ access_token: "gtok", expires_in: 3600 }),
      "POST https://meet.googleapis.com/v2/spaces": () => Response.json({ meetingUri: "https://meet.google.com/abc-defg-hij" }),
      [`PUT ${EVENT_URL}`]: (init) => { stored = String(init.body); return new Response(null, { status: 204 }); },
    });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://meet.google.com/abc-defg-hij");

    const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com"))!;
    expect(String(tokenCall.init.body)).toContain("refresh_token=grefresh");
    const spaceCall = calls.find((c) => c.url.includes("meet.googleapis.com"))!;
    expect((spaceCall.init.headers as Record<string, string>).Authorization).toBe("Bearer gtok");
    expect(JSON.parse(String(spaceCall.init.body))).toEqual({ config: { accessType: "OPEN" } });

    const put = calls.find((c) => c.init.method === "PUT")!;
    expect((put.init.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
    expect(readStoredVideo(stored)).toEqual({ provider: "google", url: "https://meet.google.com/abc-defg-hij" });
  });

  it("reuses the stored meeting without calling Google again", async () => {
    const ics = setStoredVideo(eventIcs(), { provider: "google", url: "https://meet.google.com/zzz-zzzz-zzz" });
    const { fn, calls } = fakeFetch({ [`GET ${EVENT_URL}`]: () => new Response(ics) });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.headers.get("Location")).toBe("https://meet.google.com/zzz-zzzz-zzz");
    expect(calls).toHaveLength(1);
  });

  it("retries without accessType when Meet refuses OPEN", async () => {
    const bodies: string[] = [];
    const { fn } = fakeFetch({
      [`GET ${EVENT_URL}`]: () => new Response(eventIcs()),
      "POST https://oauth2.googleapis.com/token": () => Response.json({ access_token: "gtok" }),
      "POST https://meet.googleapis.com/v2/spaces": (init) => {
        bodies.push(String(init.body));
        return bodies.length === 1
          ? new Response("bad", { status: 400 })
          : Response.json({ meetingUri: "https://meet.google.com/def-ault-xyz" });
      },
      [`PUT ${EVENT_URL}`]: () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.headers.get("Location")).toBe("https://meet.google.com/def-ault-xyz");
    expect(bodies).toEqual(['{"config":{"accessType":"OPEN"}}', "{}"]);
  });

  it("follows the other participant's meeting when both join at once (412)", async () => {
    let gets = 0;
    const { fn } = fakeFetch({
      [`GET ${EVENT_URL}`]: () => {
        gets++;
        return new Response(gets === 1
          ? eventIcs()
          : setStoredVideo(eventIcs(), { provider: "google", url: "https://meet.google.com/win-nerr-aaa" }));
      },
      "POST https://oauth2.googleapis.com/token": () => Response.json({ access_token: "gtok" }),
      "POST https://meet.googleapis.com/v2/spaces": () => Response.json({ meetingUri: "https://meet.google.com/los-erxx-bbb" }),
      [`PUT ${EVENT_URL}`]: () => new Response(null, { status: 412 }),
    });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.headers.get("Location")).toBe("https://meet.google.com/win-nerr-aaa");
  });

  it("creates a new meeting when the stored one belongs to another provider", async () => {
    const ics = setStoredVideo(eventIcs(), { provider: "google", url: "https://meet.google.com/old-oldd-old" });
    let graphBody: Record<string, unknown> = {};
    const { fn, calls } = fakeFetch({
      [`GET ${EVENT_URL}`]: () => new Response(ics),
      "POST https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token": () => Response.json({ access_token: "mtok" }),
      "POST https://graph.microsoft.com/v1.0/me/onlineMeetings": (init) => {
        graphBody = JSON.parse(String(init.body));
        return Response.json({ joinWebUrl: "https://teams.microsoft.com/l/meetup-join/abc" });
      },
      [`PUT ${EVENT_URL}`]: () => new Response(null, { status: 201 }),
    });
    vi.stubGlobal("fetch", fn);

    const res = await join(teamsEnv);
    expect(res.headers.get("Location")).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(graphBody).toMatchObject({
      subject: "Radtour am See",
      startDateTime: "2026-10-01T08:00:00.000Z",
      endDateTime: "2026-10-01T08:30:00.000Z",
    });
    const tokenBody = String(calls.find((c) => c.url.includes("login.microsoftonline.com"))!.init.body);
    expect(tokenBody).toContain("scope=OnlineMeetings.ReadWrite+offline_access");
  });

  it("falls back to Jitsi when the provider API fails", async () => {
    const { fn } = fakeFetch({
      [`GET ${EVENT_URL}`]: () => new Response(eventIcs()),
      "POST https://oauth2.googleapis.com/token": () => new Response("invalid_grant", { status: 400 }),
    });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/8x8\.vc\/vpaas-magic-cookie-test\/radtour\?jwt=/);
  });

  it("falls back to Jitsi for a room that isn't a booking", async () => {
    const { fn } = fakeFetch({ [`GET ${EVENT_URL}`]: () => new Response("", { status: 404 }) });
    vi.stubGlobal("fetch", fn);

    const res = await join(googleEnv);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/8x8\.vc\//);
  });

  it("uses Jitsi without any API call when credentials are missing", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const res = await join(baseEnv);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/8x8\.vc\//);
    expect(fn).not.toHaveBeenCalled();
  });

  it("?via=jitsi forces Jitsi for one link", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const res = await join(googleEnv, "?via=jitsi");
    expect(res.headers.get("Location")).toMatch(/^https:\/\/8x8\.vc\//);
    expect(fn).not.toHaveBeenCalled();
  });
});
