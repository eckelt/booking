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
}

const TZ = "Europe/Berlin";

export async function sendEmails(env: Env, params: EmailParams): Promise<void> {
  await Promise.all([
    sendConfirmationToBooker(env, params),
    sendNotificationToOwner(env, params),
  ]);
}

async function sendConfirmationToBooker(env: Env, p: EmailParams): Promise<void> {
  const subject = `Booking confirmed: ${p.end.getTime() - p.start.getTime() === 30 * 60000 ? 30 : 60} min with ${env.OWNER_NAME} on ${formatDate(p.start)}`;
  const text = buildBookerText(env, p);
  const html = buildBookerHtml(env, p);
  await sendSmtp(env, {
    from: `${env.OWNER_NAME} <${env.OWNER_EMAIL}>`,
    to: `${p.name} <${p.bookerEmail}>`,
    replyTo: env.OWNER_EMAIL,
    subject,
    text,
    html,
    icsAttachment: { filename: "booking.ics", content: p.icalAttachment },
  });
}

async function sendNotificationToOwner(env: Env, p: EmailParams): Promise<void> {
  const subject = `New booking: ${p.name} — ${formatDate(p.start)} ${formatTime(p.start)}`;
  const text = buildOwnerText(env, p);
  await sendSmtp(env, {
    from: `book.ecke.lt <${env.OWNER_EMAIL}>`,
    to: env.OWNER_EMAIL,
    subject,
    text,
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
${env.OWNER_NAME}`;
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

The event has been added to your ${env.CALDAV_CALENDAR_NILS} calendar.`;
}

function buildBookerHtml(env: Env, p: EmailParams): string {
  const durationMin = Math.round((p.end.getTime() - p.start.getTime()) / 60000);
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">
<h2 style="color:#1a1a1a">Booking confirmed</h2>
<table style="border-collapse:collapse;width:100%;margin:16px 0">
<tr><td style="padding:6px 12px 6px 0;color:#666">Date</td><td style="padding:6px 0"><strong>${formatDate(p.start)}</strong></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#666">Time</td><td style="padding:6px 0"><strong>${formatTime(p.start)} – ${formatTime(p.end)}</strong> (Europe/Berlin)</td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#666">Duration</td><td style="padding:6px 0">${durationMin} minutes</td></tr>
</table>
<p><a href="${p.jitsiUrl}" style="display:inline-block;padding:12px 24px;background:#0070f3;color:#fff;text-decoration:none;border-radius:6px">Join video call</a></p>
<p style="color:#666;font-size:14px">No app needed — works in your browser.</p>
${p.notes ? `<p><strong>Notes:</strong><br>${escapeHtml(p.notes)}</p>` : ""}
<p>Looking forward to talking!<br>${escapeHtml(env.OWNER_NAME)}</p>
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── SMTP ─────────────────────────────────────────────────────────────────────

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
  // Cloudflare Workers support outbound TCP via the connect() API (nodejs_compat)
  // We use port 465 (SMTPS — implicit TLS)
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: "smtp.fastmail.com", port: 465 }, { secureTransport: "on" });

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  const send = async (line: string) => {
    await writer.write(new TextEncoder().encode(line + "\r\n"));
  };

  const readLine = async (): Promise<string> => {
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      if (buf.includes("\r\n")) break;
    }
    return buf.trim();
  };

  await readLine(); // 220 greeting

  await send(`EHLO book.ecke.lt`);
  let ehlo = "";
  while (true) {
    const line = await readLine();
    ehlo += line;
    if (line.startsWith("250 ")) break;
  }
  void ehlo;

  // AUTH PLAIN
  const authStr = btoa(`\x00${env.SMTP_USERNAME}\x00${env.SMTP_PASSWORD}`);
  await send(`AUTH PLAIN ${authStr}`);
  await readLine(); // 235

  await send(`MAIL FROM:<${env.OWNER_EMAIL}>`);
  await readLine();

  const toAddr = msg.to.match(/<(.+)>/)?.[1] ?? msg.to;
  await send(`RCPT TO:<${toAddr}>`);
  await readLine();

  await send("DATA");
  await readLine(); // 354

  const rawMsg = buildRawMessage(msg);
  await send(rawMsg);
  await send(".");
  await readLine(); // 250

  await send("QUIT");
  await reader.cancel();
  await writer.close();
}

function buildRawMessage(msg: SmtpMessage): string {
  const boundary = `boundary_${Date.now()}`;
  const lines: string[] = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    msg.replyTo ? `Reply-To: ${msg.replyTo}` : "",
    `Subject: ${msg.subject}`,
    `MIME-Version: 1.0`,
  ].filter(Boolean);

  if (!msg.html && !msg.icsAttachment) {
    lines.push("Content-Type: text/plain; charset=utf-8", "", msg.text);
  } else {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`);
    if (msg.html) {
      const innerBoundary = `inner_${Date.now()}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${innerBoundary}"`, "");
      lines.push(`--${innerBoundary}`, "Content-Type: text/plain; charset=utf-8", "", msg.text, "");
      lines.push(`--${innerBoundary}`, "Content-Type: text/html; charset=utf-8", "", msg.html, "");
      lines.push(`--${innerBoundary}--`);
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
        btoa(msg.icsAttachment.content)
      );
    }

    lines.push(`--${boundary}--`);
  }

  return lines.join("\r\n");
}
