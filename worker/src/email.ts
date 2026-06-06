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
  await sendMailChannels({
    from: { email: env.OWNER_EMAIL, name: env.OWNER_NAME },
    to: [{ email: p.bookerEmail, name: p.name }],
    replyTo: { email: env.OWNER_EMAIL },
    subject,
    text: buildBookerText(env, p),
    html: buildBookerHtml(env, p),
    icsAttachment: { filename: "booking.ics", content: p.icalAttachment },
  });
}

async function sendNotificationToOwner(env: Env, p: EmailParams): Promise<void> {
  const subject = `New booking: ${p.name} — ${formatDate(p.start)} ${formatTime(p.start)}`;
  await sendMailChannels({
    from: { email: env.OWNER_EMAIL, name: "book.ecke.lt" },
    to: [{ email: env.OWNER_EMAIL }],
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

// ── MailChannels ────────────────────────────────────────────────────────────────

interface MailChannelsMessage {
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  replyTo?: { email: string };
  subject: string;
  text: string;
  html?: string;
  icsAttachment?: { filename: string; content: string };
}

async function sendMailChannels(msg: MailChannelsMessage): Promise<void> {
  const personalizations = [{ to: msg.to }];

  const content: { type: string; value: string }[] = [
    { type: "text/plain", value: msg.text },
  ];
  if (msg.html) {
    content.push({ type: "text/html", value: msg.html });
  }

  const attachments: { filename: string; content: string; type: string }[] = [];
  if (msg.icsAttachment) {
    attachments.push({
      filename: msg.icsAttachment.filename,
      content: btoa(msg.icsAttachment.content),
      type: "text/calendar",
    });
  }

  const body: Record<string, unknown> = {
    personalizations,
    from: msg.from,
    subject: msg.subject,
    content,
  };
  if (msg.replyTo) body["reply_to"] = msg.replyTo;
  if (attachments.length > 0) body["attachments"] = attachments;

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 202) {
    const detail = await res.text().catch(() => "");
    throw new Error(`MailChannels failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
