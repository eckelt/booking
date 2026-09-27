import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";

// Minimal in-memory KVNamespace fake — just enough of get/put for
// checkRateLimit (worker/src/index.ts). No expiry simulation needed: these
// tests never outlive a single rate-limit window.
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

const baseEnv = {
  OWNER_NAME: "Nils Eckelt",
  OWNER_EMAIL: "nils@ecke.lt",
  CALDAV_USERNAME: "nils@ecke.lt",
  CALDAV_PASSWORD: "secret",
  CALDAV_CALENDAR_NILS: "Nils",
  CALDAV_CALENDAR_OHANA: "Ohana",
  SMTP_USERNAME: "nils@ecke.lt",
  SMTP_PASSWORD: "smtp-secret",
};

const fakeCtx = {
  waitUntil: (p: Promise<unknown>) => {
    p.catch(() => {});
  },
} as unknown as ExecutionContext;

describe("checkRateLimit via /api/book and /api/cancel (worker/src/index.ts)", () => {
  // Body is intentionally invalid/absent — checkRateLimit runs before any
  // body/uid parsing, so these requests either 429 (limit hit) or fail their
  // own validation (422/400) without ever reaching CalDAV.
  const bookReq = (ip: string) =>
    new Request("https://book.ecke.lt/api/book", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  const cancelReq = (ip: string) =>
    new Request("https://book.ecke.lt/api/cancel", {
      headers: { "CF-Connecting-IP": ip },
    });

  it("/api/book: 429s once an IP passes 5 requests within the hour", async () => {
    const env = { ...baseEnv, RATE_LIMIT: fakeKV() } as Env;
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await worker.fetch(bookReq("203.0.113.9"), env, fakeCtx);
    }
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error?: string };
    expect(body.error).toMatch(/Zu viele Anfragen/);
  });

  it("/api/book: the limit is per IP, not global", async () => {
    const env = { ...baseEnv, RATE_LIMIT: fakeKV() } as Env;
    for (let i = 0; i < 5; i++) {
      await worker.fetch(bookReq("203.0.113.9"), env, fakeCtx);
    }
    const otherIp = await worker.fetch(bookReq("203.0.113.10"), env, fakeCtx);
    expect(otherIp.status).not.toBe(429);
  });

  it("/api/cancel: 429s once an IP passes 10 requests within the hour", async () => {
    const env = { ...baseEnv, RATE_LIMIT: fakeKV() } as Env;
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await worker.fetch(cancelReq("203.0.113.9"), env, fakeCtx);
    }
    expect(last!.status).toBe(429);
  });

  it("without the RATE_LIMIT binding, no request is throttled", async () => {
    const env = { ...baseEnv } as Env; // no RATE_LIMIT bound
    let last: Response | undefined;
    for (let i = 0; i < 20; i++) {
      last = await worker.fetch(bookReq("203.0.113.9"), env, fakeCtx);
    }
    expect(last!.status).not.toBe(429);
  });
});
