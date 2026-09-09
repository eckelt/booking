import type { Env } from "./types.js";

export interface EmailParams {
  uid: string;
  start: Date;
  end: Date;
  name: string;
  bookerEmail: string;
  notes: string;
  jitsiUrl: string;
  icalAttachment: string;
  cancelUrl: string;
  rescheduleUrl: string;
}

const TZ = "Europe/Berlin";

// The booker getting no confirmation is the worst failure mode this system
// has, so each send is retried, the two sends are independent (one failing
// never cancels the other), and a booker-mail failure that survives all
// retries pages the owner so it's caught by a human instead of vanishing.
export async function sendEmails(env: Env, params: EmailParams): Promise<void> {
  const [booker, owner] = await Promise.allSettled([
    withRetry(() => sendConfirmationToBooker(env, params)),
    withRetry(() => sendNotificationToOwner(env, params)),
  ]);

  if (booker.status === "rejected") {
    await sendOwnerAlert(env, params, booker.reason).catch((err) =>
      console.error(`[email] owner alert ALSO failed uid=${params.uid} error=${errMsg(err)}`),
    );
  }

  const failures = [booker, owner].filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failures.length) {
    throw new Error(
      `email send failed: ${failures.map((f) => errMsg(f.reason)).join("; ")}`,
    );
  }
}

const RETRY_ATTEMPTS = 3;

// Retry a send a few times with exponential backoff. Most SMTP failures worth
// retrying are transient (greylisting, a dropped socket, a brief 4xx); a hard
// 5xx will just fail three times fast, which is fine.
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = RETRY_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Last-resort heads-up to the owner when the booker's confirmation could not
// be delivered: plain text, no attachment, so it has the best possible chance
// of getting through on its own.
async function sendOwnerAlert(env: Env, p: EmailParams, reason: unknown): Promise<void> {
  await sendSmtp(env, {
    from: `book.ecke.lt <${env.OWNER_EMAIL}>`,
    to: env.OWNER_EMAIL,
    subject: `[ACTION NEEDED] Confirmation to ${p.name} could not be sent`,
    text: `The booking went through and is in your calendar, but the confirmation
email to the booker could NOT be sent after ${RETRY_ATTEMPTS} attempts.

Please contact them directly with the call details.

Name:  ${p.name}
Email: ${p.bookerEmail}
Date:  ${formatDate(p.start)}
Time:  ${formatTime(p.start)} – ${formatTime(p.end)} (Europe/Berlin)
Join:  ${p.jitsiUrl}

Error: ${errMsg(reason)}`,
  });
}

async function sendConfirmationToBooker(env: Env, p: EmailParams): Promise<void> {
  const subject = `Booking confirmed: ${p.end.getTime() - p.start.getTime() === 30 * 60000 ? 30 : 60} min with ${env.OWNER_NAME} on ${formatDate(p.start)}`;
  await sendSmtp(env, {
    from: `${env.OWNER_NAME} <${env.OWNER_EMAIL}>`,
    to: `${p.name} <${p.bookerEmail}>`,
    replyTo: env.OWNER_EMAIL,
    subject,
    text: buildBookerText(env, p),
    html: buildBookerHtml(env, p),
    icsAttachment: { filename: "booking.ics", content: addMethodPublish(p.icalAttachment) },
  });
}

async function sendNotificationToOwner(env: Env, p: EmailParams): Promise<void> {
  const subject = `New booking: ${p.name} — ${formatDate(p.start)} ${formatTime(p.start)}`;
  await sendSmtp(env, {
    from: `book.ecke.lt <${env.OWNER_EMAIL}>`,
    to: env.OWNER_EMAIL,
    subject,
    text: buildOwnerText(env, p),
  });
}

function buildBookerText(env: Env, p: EmailParams): string {
  return `Hi ${p.name},

your booking is confirmed.

Date:     ${formatDate(p.start)}
Time:     ${formatTime(p.start)} – ${formatTime(p.end)} (Europe/Berlin)
Duration: ${Math.round((p.end.getTime() - p.start.getTime()) / 60000)} minutes

Join the video call here:
${p.jitsiUrl}

(No app needed — works in your browser.)

Notes you left:
${p.notes || "—"}

Looking forward to talking!
${env.OWNER_NAME}

──────────────────────────
Need to change your plans?
Reschedule: ${p.rescheduleUrl}
Cancel:     ${p.cancelUrl}`;
}

function buildOwnerText(env: Env, p: EmailParams): string {
  return `New booking received via book.ecke.lt

Name:  ${p.name}
Email: ${p.bookerEmail}
Date:  ${formatDate(p.start)}
Time:  ${formatTime(p.start)} – ${formatTime(p.end)} (Europe/Berlin)

Jitsi: ${p.jitsiUrl}

Notes:
${p.notes || "—"}

The event has been added to your calendar.`;
}

function buildBookerHtml(env: Env, p: EmailParams): string {
  const durationMin = Math.round((p.end.getTime() - p.start.getTime()) / 60000);
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#2c292d">
<h2 style="color:#006e8a;font-weight:600;margin-bottom:4px">Booking confirmed</h2>
<table style="border-collapse:collapse;width:100%;margin:16px 0">
<tr><td style="padding:6px 12px 6px 0;color:#736e73">Date</td><td style="padding:6px 0"><strong>${formatDate(p.start)}</strong></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#736e73">Time</td><td style="padding:6px 0"><strong>${formatTime(p.start)} – ${formatTime(p.end)}</strong> (Europe/Berlin)</td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#736e73">Duration</td><td style="padding:6px 0">${durationMin} minutes</td></tr>
</table>
<p><a href="${p.jitsiUrl}" style="display:inline-block;padding:12px 24px;background:#006e8a;color:#fff;text-decoration:none;border-radius:0.3rem">Join video call</a></p>
<p style="color:#736e73;font-size:14px">No app needed — works in your browser.</p>
${p.notes ? `<p><strong>Notes:</strong><br>${escapeHtml(p.notes)}</p>` : ""}
<p>Looking forward to talking!<br>${escapeHtml(env.OWNER_NAME)}</p>
<hr style="border:none;border-top:1px solid #e8e2dc;margin:24px 0">
<p style="color:#736e73;font-size:14px">Need to change your plans?</p>
<p>
  <a href="${p.rescheduleUrl}" style="display:inline-block;padding:10px 20px;background:#edf4f6;border:1px solid #e8e2dc;color:#4a6b73;text-decoration:none;border-radius:999px;margin-right:8px">Reschedule</a>
  <a href="${p.cancelUrl}" style="display:inline-block;padding:10px 20px;background:#fdf0f2;border:1px solid #e8e2dc;color:#b01040;text-decoration:none;border-radius:999px">Cancel booking</a>
</p>
</body>
</html>`;
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Insert METHOD:PUBLISH after PRODID so mail clients treat it as informational,
// not as a meeting request that triggers a second calendar invitation email.
function addMethodPublish(ical: string): string {
  return ical.replace(/(PRODID:[^\r\n]+\r?\n)/, "$1METHOD:PUBLISH\r\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── SMTP (Fastmail, port 465 implicit TLS) ────────────────────────────────────────────

interface SmtpMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  icsAttachment?: { filename: string; content: string };
}

async function sendSmtp(env: Env, msg: SmtpMessage): Promise<void> {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: "smtp.fastmail.com", port: 465 }, { secureTransport: "on" });

  let writer: WritableStreamDefaultWriter | undefined;
  let reader: ReadableStreamDefaultReader | undefined;
  try {
    writer = socket.writable.getWriter();
    reader = socket.readable.getReader();
    const dec = new TextDecoder();
    let lineBuf = "";

    // Read one CRLF-terminated line, buffering leftovers for the next call.
    const readLine = async (): Promise<string> => {
      while (true) {
        const idx = lineBuf.indexOf("\r\n");
        if (idx !== -1) {
          const line = lineBuf.slice(0, idx);
          lineBuf = lineBuf.slice(idx + 2);
          return line;
        }
        const { value, done } = await reader!.read();
        if (done) throw new Error("SMTP: connection closed unexpectedly");
        lineBuf += dec.decode(value, { stream: true });
      }
    };

    // Consume all continuation lines ("250-...") and return the final one ("250 ...").
    const readResponse = async (): Promise<string> => {
      let line = "";
      do { line = await readLine(); } while (line.length >= 4 && line[3] === "-");
      return line;
    };

    const send = async (line: string) => {
      await writer!.write(new TextEncoder().encode(line + "\r\n"));
    };

    // Read the reply to the command just sent and fail loudly unless its
    // status code is one we expect. Previously every reply after AUTH was
    // read and discarded, so a 5xx rejection of the recipient or the message
    // body (e.g. an over-long line) sailed through as a "successful" send.
    const expectReply = async (want: number[], step: string): Promise<string> => {
      const reply = await readResponse();
      const code = parseInt(reply.slice(0, 3), 10);
      if (!want.includes(code)) {
        throw new Error(`SMTP ${step} rejected: ${reply.trim()}`);
      }
      return reply;
    };

    await expectReply([220], "greeting");
    await send("EHLO book.ecke.lt");
    await expectReply([250], "EHLO");

    const authStr = btoa(`\x00${env.SMTP_USERNAME}\x00${env.SMTP_PASSWORD}`);
    await send(`AUTH PLAIN ${authStr}`);
    await expectReply([235], "AUTH");

    await send(`MAIL FROM:<${env.OWNER_EMAIL}>`);
    await expectReply([250], "MAIL FROM");

    const toAddr = msg.to.match(/<(.+)>/)?.[1] ?? msg.to;
    await send(`RCPT TO:<${toAddr}>`);
    await expectReply([250, 251], "RCPT TO");

    await send("DATA");
    await expectReply([354], "DATA");

    await send(dotStuff(buildRawMessage(msg)));
    await send(".");
    await expectReply([250], "message body");

    await send("QUIT");
    await reader.cancel();
    await writer.close();
  } catch (err) {
    try { await writer?.close(); } catch { /* ignore */ }
    try { await reader?.cancel(); } catch { /* ignore */ }
    throw err;
  }
}

// SMTP dot-stuffing (RFC 5321 §4.5.2): a line inside DATA that starts with "."
// must be sent with the dot doubled, or the receiver reads it as the
// end-of-data terminator and truncates (or rejects) the message. Booker notes
// flow into the text/HTML parts, so this is reachable from user input.
export function dotStuff(data: string): string {
  return data.replace(/^\./, "..").replace(/\r\n\./g, "\r\n..");
}

// btoa() only accepts Latin-1 (code points 0-255) and throws on anything
// beyond it — e.g. the em dash ("—") that DESCRIPTION falls back to for a
// booking without notes (see buildIcal). Route through UTF-8 bytes first so
// the .ics attachment never crashes email sending on ordinary Unicode text.
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

// MIME base64 must be wrapped at 76 chars per line (RFC 2045 §6.8). Emitting
// it as one long line also blows past the SMTP 1000-octet line limit (RFC 5321
// §4.5.3.1.6) once the .ics carries a VALARM and/or any notes — Fastmail then
// rejects the whole message, which is exactly how booker confirmations went
// missing with no bounce and no error.
export function wrapBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? [b64]).join("\r\n");
}

export function buildRawMessage(msg: SmtpMessage): string {
  const boundary = `boundary_${Date.now()}`;
  const lines: string[] = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `Subject: ${msg.subject}`,
    `MIME-Version: 1.0`,
  ];

  if (!msg.html && !msg.icsAttachment) {
    lines.push("Content-Type: text/plain; charset=utf-8", "", msg.text);
  } else {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`);
    if (msg.html) {
      const inner = `inner_${Date.now()}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${inner}"`, "");
      lines.push(`--${inner}`, "Content-Type: text/plain; charset=utf-8", "", msg.text, "");
      lines.push(`--${inner}`, "Content-Type: text/html; charset=utf-8", "", msg.html, "");
      lines.push(`--${inner}--`);
    } else {
      lines.push("Content-Type: text/plain; charset=utf-8", "", msg.text);
    }
    if (msg.icsAttachment) {
      lines.push(`--${boundary}`);
      lines.push(
        `Content-Type: text/calendar; charset=utf-8; name="${msg.icsAttachment.filename}"`,
        `Content-Disposition: attachment; filename="${msg.icsAttachment.filename}"`,
        `Content-Transfer-Encoding: base64`,
        "",
        wrapBase64(utf8ToBase64(msg.icsAttachment.content))
      );
    }
    lines.push(`--${boundary}--`);
  }

  return lines.join("\r\n");
}
