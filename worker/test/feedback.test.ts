import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import {
  findEvent,
  isOpen,
  validateFeedback,
  buildFeedbackMail,
  pickLang,
  FeedbackError,
  type FeedbackEvent,
} from "../src/feedback.js";
import { buildRawMessage, encodeHeader } from "../src/email.js";
import type { Env } from "../src/types.js";

const env = {
  OWNER_NAME: "Nils Eckelt",
  OWNER_EMAIL: "nils@ecke.lt",
  FEEDBACK_EMAIL: "feedback@nils.ecke.lt",
} as Env;

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const bmi: FeedbackEvent = { title: "Agentic Enablement BMI Kiel", date: "2026-09-23", lang: "de" };

function get(path: string, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`https://feedback.ecke.lt${path}`, { headers }), env, ctx);
}

function post(body: unknown) {
  return worker.fetch(
    new Request("https://feedback.ecke.lt/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
}

describe("findEvent", () => {
  it("finds the BMI workshop case-insensitively", () => {
    expect(findEvent("bmi")?.title).toBe("Agentic Enablement BMI Kiel");
    expect(findEvent("BMI")?.lang).toBe("de");
  });

  it("rejects unknown slugs and prototype keys", () => {
    expect(findEvent("nope")).toBeNull();
    expect(findEvent("constructor")).toBeNull();
    expect(findEvent("__proto__")).toBeNull();
  });
});

describe("isOpen", () => {
  it("is open before the event, and through the 10th day after it (Berlin time)", () => {
    expect(isOpen(bmi, new Date("2026-09-22T12:00:00Z"))).toBe(true);
    expect(isOpen(bmi, new Date("2026-10-03T21:59:00Z"))).toBe(true); // 23:59 Berlin
  });

  it("closes at midnight Berlin after the 10th day", () => {
    expect(isOpen(bmi, new Date("2026-10-03T22:00:00Z"))).toBe(false); // 00:00 Berlin
  });

  it("honours a per-event openDays override", () => {
    expect(isOpen({ ...bmi, openDays: 3 }, new Date("2026-09-27T10:00:00Z"))).toBe(false);
  });
});

describe("validateFeedback", () => {
  it("accepts a thumbs-up without text", () => {
    expect(validateFeedback({ slug: "bmi", rating: "up" })).toEqual({
      slug: "bmi", rating: "up", text: "", name: "", lang: "de",
    });
  });

  it("requires a reason for thumbs-down", () => {
    expect(() => validateFeedback({ rating: "down", text: "   " })).toThrow("reason_required");
    expect(validateFeedback({ rating: "down", text: "zu schnell" }).text).toBe("zu schnell");
  });

  it("rejects unknown ratings and oversized input", () => {
    expect(() => validateFeedback({ rating: "meh" })).toThrow(FeedbackError);
    expect(() => validateFeedback({ rating: "up", text: "x".repeat(5001) })).toThrow("too_long");
    expect(() => validateFeedback({ rating: "up", name: "x".repeat(101) })).toThrow("too_long");
  });
});

describe("buildFeedbackMail", () => {
  it("addresses FEEDBACK_EMAIL with event, rating and text", () => {
    const mail = buildFeedbackMail(
      env,
      { slug: "bmi", rating: "side", text: "Hmm.", name: "", lang: "de" },
      bmi,
    );
    expect(mail.to).toBe("feedback@nils.ecke.lt");
    expect(mail.subject).toBe(
      "[Feedback] Agentic Enablement BMI Kiel – 👉 Nicht gut, kann dir aber nicht sagen warum",
    );
    expect(mail.text).toContain("Name:    anonym");
    expect(mail.text).toContain("Hmm.");
  });

  it("falls back to OWNER_EMAIL and a general subject", () => {
    const mail = buildFeedbackMail(
      { ...env, FEEDBACK_EMAIL: undefined },
      { slug: null, rating: "up", text: "", name: "Jane", lang: "en" },
      null,
    );
    expect(mail.to).toBe("nils@ecke.lt");
    expect(mail.subject).toContain("Allgemeines Feedback");
  });

  it("produces a raw message with an encoded subject and no over-long lines", () => {
    const mail = buildFeedbackMail(
      env,
      { slug: "bmi", rating: "down", text: "sehr lang ".repeat(500), name: "", lang: "de" },
      bmi,
    );
    const raw = buildRawMessage(mail);
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    expect(raw).toMatch(/^Subject: =\?UTF-8\?B\?/m);
  });
});

describe("encodeHeader", () => {
  it("leaves ASCII alone and round-trips non-ASCII in <=75-char words", () => {
    expect(encodeHeader("New booking")).toBe("New booking");
    const value = "[Feedback] Agentic Enablement BMI Kiel – 👎 Schlecht, weil …";
    const words = encodeHeader(value).split("\r\n ");
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded = words
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf-8"))
      .join("");
    expect(decoded).toBe(value);
  });
});

describe("feedback.ecke.lt routing", () => {
  it("serves the prefilled German form for /bmi", async () => {
    const res = await get("/bmi");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agentic Enablement BMI Kiel");
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("Ich bleibe lieber anonym");
    expect(html).toContain('"slug":"bmi"');
  });

  it("serves a general form at / in the browser's language", async () => {
    const res = await get("/", { "Accept-Language": "en-US,en;q=0.9" });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('"slug":null');
    expect(pickLang("de-DE,de;q=0.9")).toBe("de");
  });

  it("404s unknown events with a link to the general form", async () => {
    const res = await get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('href="/"');
  });

  it("does not expose the booking API on the feedback host", async () => {
    const res = await get("/api/slots");
    expect(res.status).toBe(404);
  });

  it("rejects a thumbs-down without reason", async () => {
    const res = await post({ slug: "bmi", rating: "down", text: "" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "reason_required" });
  });

  it("rejects submissions for unknown events", async () => {
    const res = await post({ slug: "nope", rating: "up" });
    expect(res.status).toBe(404);
  });

  it("silently accepts honeypot submissions without sending", async () => {
    const res = await post({ slug: "bmi", rating: "up", website: "http://spam" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
