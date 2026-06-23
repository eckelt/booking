import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJitsiUrl, generateUid } from "../src/jitsi.js";

const FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----";
const APP_ID = "vpaas-magic-cookie-test";
const KEY_ID = "testkey";

describe("generateUid", () => {
  it("is 10 hex characters", () => {
    expect(generateUid()).toMatch(/^[0-9a-f]{10}$/);
  });

  it("generates unique IDs", () => {
    expect(generateUid()).not.toBe(generateUid());
  });
});

describe("generateJitsiUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto),
      subtle: {
        importKey: vi.fn().mockResolvedValue({} as CryptoKey),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a JaaS 8x8.vc URL with appId and uid", async () => {
    const uid = "4dc3a700cf";
    const start = new Date("2026-07-01T10:00:00Z");
    const end = new Date("2026-07-01T10:30:00Z");
    const url = await generateJitsiUrl(uid, start, end, APP_ID, KEY_ID, FAKE_PEM);
    expect(url).toMatch(new RegExp(`^https://8x8\\.vc/${APP_ID}/${uid}\\?jwt=`));
  });

  it("JWT has three dot-separated parts", async () => {
    const uid = "4dc3a700cf";
    const start = new Date("2026-07-01T10:00:00Z");
    const end = new Date("2026-07-01T10:30:00Z");
    const url = await generateJitsiUrl(uid, start, end, APP_ID, KEY_ID, FAKE_PEM);
    const jwt = url.split("?jwt=")[1];
    expect(jwt.split(".")).toHaveLength(3);
  });
});
