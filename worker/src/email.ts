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
  await sendSmtp(env, {
    from: `${env.OWNER_NAME} <${env.OWNER_EMAIL}>`,
    to: `${p.name} <${p.bookerEmail}>`,
    replyTo: env.OWNER_EMAIL,
    subject,
    text: buildBookerText(env, p),
    html: buildBookerHtml(env, p),
    icsAttachment: { filename: "booking.ics", content: p.icalAttachment },
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

The event has been added to your calendar.`;
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

// ── SMTP (Fastmail, port 465 implicit TLS) ────────────────────────────────────

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

    await readResponse(); // 220 greeting
    await send("EHLO book.ecke.lt");
    await readResponse(); // 250 capabilities (multi-line)

    const authStr = btoa(`\x00${env.SMTP_USERNAME}\x00${env.SMTP_PASSWORD}`);
    await send(`AUTH PLAIN ${authStr}`);
    const authReply = await readResponse();
    if (!authReply.startsWith("235")) throw new Error(`SMTP AUTH failed: ${authReply}`);

    await send(`MAIL FROM:<${env.OWNER_EMAIL}>`);
    await readResponse();

    const toAddr = msg.to.match(/<(.+)>/)?.[1] ?? msg.to;
    await send(`RCPT TO:<${toAddr}>`);
    await readResponse();

    await send("DATA");
    await readResponse(); // 354

    await send(buildRawMessage(msg));
    await send(".");
    await readResponse(); // 250

    await send("QUIT");
    await reader.cancel();
    await writer.close();
  } catch (err) {
    try { await writer?.close(); } catch { /* ignore */ }
    try { await reader?.cancel(); } catch { /* ignore */ }
    throw err;
  }
}

function buildRawMessage(msg: SmtpMessage): string {
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
        btoa(msg.icsAttachment.content)
      );
    }
    lines.push(`--${boundary}--`);
  }

  return lines.join("\r\n");
}
