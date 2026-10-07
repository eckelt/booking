import type { Env } from "./types.js";

// Signed booking links: cancel, reschedule and join links carry an
// HMAC-SHA256 token over the uid as query parameter `t`, so knowing (or
// guessing) a uid alone is no longer enough to cancel, move or join a
// booking. Nothing is stored — the token is recomputed from the uid and the
// Worker secret LINK_SIGNING_SECRET. Each purpose has its own prefix, so a
// join token can't be replayed as a cancel token.

export type LinkPurpose = "cancel" | "reschedule" | "join";

// Transition period for links sent before signing existed (old confirmation
// mails and calendar entries): requests WITHOUT `t` are still accepted up to
// and including 2026-10-31 (Europe/Berlin, CET = UTC+1 after the DST switch
// on 2026-10-25), i.e. strictly before this instant. A wrong `t` is always
// rejected. Remove this constant (and the branch using it) once it has passed.
export const UNSIGNED_LINK_GRACE_END = new Date("2026-11-01T00:00:00+01:00");

const encoder = new TextEncoder();

function message(purpose: LinkPurpose, uid: string): Uint8Array {
  return encoder.encode(`booking-link:${purpose}:${uid}`);
}

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(token: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function signLinkToken(secret: string, purpose: LinkPurpose, uid: string): Promise<string> {
  const key = await importKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, message(purpose, uid));
  return toB64url(new Uint8Array(sig));
}

// Constant-time check via WebCrypto's HMAC verify.
export async function verifyLinkToken(
  secret: string,
  purpose: LinkPurpose,
  uid: string,
  token: string,
): Promise<boolean> {
  const sig = fromB64url(token);
  if (!sig) return false;
  const key = await importKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, sig, message(purpose, uid));
}

// Decides whether a request for `uid` may proceed. `token` is the raw `t`
// query parameter (null when absent).
// - With `t`: valid only if LINK_SIGNING_SECRET is set and the signature
//   matches (fail-closed without a secret).
// - Without `t`: accepted only during the transition period.
export async function isLinkAuthorized(
  env: Env,
  purpose: LinkPurpose,
  uid: string,
  token: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const secret = env.LINK_SIGNING_SECRET?.trim();
  if (token !== null) {
    if (!secret) return false;
    return verifyLinkToken(secret, purpose, uid, token);
  }
  return now.getTime() < UNSIGNED_LINK_GRACE_END.getTime();
}

export interface BookingLinks {
  joinUrl: string;
  cancelUrl: string;
  rescheduleUrl: string;
}

// Builds the booker-facing links for a booking. Without LINK_SIGNING_SECRET
// the links stay unsigned (and stop working after the transition period);
// that is logged as a warning without uid or e-mail.
export async function buildBookingLinks(env: Env, uid: string): Promise<BookingLinks> {
  const joinBase = `https://join.ecke.lt/${uid}`;
  const cancelBase = `https://book.ecke.lt/api/cancel?uid=${uid}`;
  const rescheduleBase = `https://book.ecke.lt/?reschedule=${uid}`;
  const secret = env.LINK_SIGNING_SECRET?.trim();
  if (!secret) {
    console.warn("[links] LINK_SIGNING_SECRET is not set — booking links are sent unsigned");
    return { joinUrl: joinBase, cancelUrl: cancelBase, rescheduleUrl: rescheduleBase };
  }
  const [tJoin, tCancel, tReschedule] = await Promise.all([
    signLinkToken(secret, "join", uid),
    signLinkToken(secret, "cancel", uid),
    signLinkToken(secret, "reschedule", uid),
  ]);
  return {
    joinUrl: `${joinBase}?t=${tJoin}`,
    cancelUrl: `${cancelBase}&t=${tCancel}`,
    rescheduleUrl: `${rescheduleBase}&t=${tReschedule}`,
  };
}

// Join link for the owner's own calendar entry: the host link
// (`?host=<HOST_JOIN_SECRET>`) stays as before and needs no `t`; without a
// host secret it falls back to the signed guest link.
export async function ownerJoinUrl(env: Env, uid: string): Promise<string> {
  const base = `https://join.ecke.lt/${uid}`;
  if (env.HOST_JOIN_SECRET) return `${base}?host=${env.HOST_JOIN_SECRET}`;
  const secret = env.LINK_SIGNING_SECRET?.trim();
  return secret ? `${base}?t=${await signLinkToken(secret, "join", uid)}` : base;
}
