import type { FeedbackEvent, Lang } from "./feedback.js";
import { MAX_NAME, MAX_TEXT } from "./feedback.js";

// Markup for feedback.ecke.lt. Styling comes from the shared ecke.lt design
// system (via book.ecke.lt/styles.css); the inline :root block is only a
// fallback in case that stylesheet can't be fetched.

const STRINGS = {
  de: {
    pageTitle: "Feedback",
    eyebrowEvent: "Feedback zu",
    eyebrowGeneral: "Feedback",
    generalTitle: "Wie war's?",
    ratingUp: "Nicht schlecht",
    ratingSide: "Nicht gut – kann dir aber nicht sagen, warum",
    ratingDown: "Schlecht, weil …",
    hint: "Dreh den Daumen – oder tipp drauf",
    dialLabel: "Bewertung",
    textLabel: "Dein Feedback",
    textLabelRequired: "Dein Feedback (bitte sag mir, warum)",
    placeholderUp: "Was war gut? Was nimmst du mit?",
    placeholderSide: "Vielleicht fällt dir ja doch was ein …",
    placeholderDown: "… weil",
    nameLabel: "Name (optional)",
    namePlaceholder: "Ich bleibe lieber anonym",
    send: "Senden",
    sending: "Wird gesendet …",
    thanksTitle: "Danke!",
    thanksText: "Dein Feedback ist angekommen.",
    again: "Noch etwas ergänzen",
    errReason: "Sag mir bitte kurz, warum – dafür ist das Feld da.",
    errTooLong: "Das ist leider zu lang.",
    errClosed: "Für diese Veranstaltung ist das Feedback inzwischen geschlossen.",
    errGeneric: "Das hat leider nicht geklappt. Versuch es bitte gleich noch einmal.",
    notFoundTitle: "Nicht gefunden",
    notFoundText: "Zu diesem Link gibt es keine Veranstaltung. Allgemeines Feedback geht aber immer:",
    closedTitle: "Feedback geschlossen",
    closedText: "Für diese Veranstaltung nehme ich kein Feedback mehr entgegen. Allgemeines Feedback geht aber immer:",
    generalLink: "Zum Feedback-Formular",
  },
  en: {
    pageTitle: "Feedback",
    eyebrowEvent: "Feedback on",
    eyebrowGeneral: "Feedback",
    generalTitle: "How was it?",
    ratingUp: "Not bad",
    ratingSide: "Not good – can't tell you why, though",
    ratingDown: "Bad, because …",
    hint: "Turn the thumb – or tap it",
    dialLabel: "Rating",
    textLabel: "Your feedback",
    textLabelRequired: "Your feedback (please tell me why)",
    placeholderUp: "What worked? What will you take away?",
    placeholderSide: "Maybe something comes to mind after all …",
    placeholderDown: "… because",
    nameLabel: "Name (optional)",
    namePlaceholder: "I'd rather stay anonymous",
    send: "Send",
    sending: "Sending …",
    thanksTitle: "Thank you!",
    thanksText: "Your feedback has arrived.",
    again: "Add something else",
    errReason: "Please tell me briefly why – that's what the field is for.",
    errTooLong: "Sorry, that's too long.",
    errClosed: "Feedback for this event has closed.",
    errGeneric: "Sorry, that didn't work. Please try again in a moment.",
    notFoundTitle: "Not found",
    notFoundText: "There's no event behind this link. General feedback is always welcome, though:",
    closedTitle: "Feedback closed",
    closedText: "I'm no longer collecting feedback for this event. General feedback is always welcome, though:",
    generalLink: "Go to the feedback form",
  },
} satisfies Record<Lang, Record<string, string>>;

const FALLBACK_TOKENS = `
  :root {
    --bg: #fafaf9; --surface: #fff; --text: #2c292d; --muted: #736e73; --border: #e5e5e5;
    --primary: #006e8a; --primary-hover: #005570; --on-primary: #fff; --danger: #b01040;
    --badge-ai: #4a7a00; --badge-ai-bg: rgba(74,122,0,.1);
    --badge-lead: #7a5a00; --badge-lead-bg: rgba(122,90,0,.1);
    --badge-ux: #b01040; --badge-ux-bg: rgba(176,16,64,.1);
    --font-heading: "Bricolage Grotesque", system-ui, sans-serif;
    --font-body: "DM Sans", system-ui, sans-serif;
    --font-root: 17px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #19181a; --surface: #2d2a2e; --text: #fcfcfa; --muted: #848085; --border: #403e41;
      --primary: #78dce8; --primary-hover: #60cfe2; --on-primary: #19181a; --danger: #ff6188;
      --badge-ai: #a9dc76; --badge-ai-bg: rgba(169,220,118,.12);
      --badge-lead: #ffd866; --badge-lead-bg: rgba(255,216,102,.12);
      --badge-ux: #ff6188; --badge-ux-bg: rgba(255,97,136,.12);
    }
  }
`;

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: var(--font-root); }
  body { font-family: var(--font-body); background: var(--bg); color: var(--text); min-height: 100vh; min-height: 100dvh; -webkit-tap-highlight-color: transparent; }
  header { position: sticky; top: 0; z-index: 10; padding: 1rem 1rem; border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    display: flex; align-items: center; gap: 1rem; }
  header h1 { flex: 1; font-family: var(--font-heading); font-size: 1.1rem; font-weight: 600; letter-spacing: -0.01em; }
  .lang-switch { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: var(--bg); }
  .lang-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0.35rem 0.7rem; font: 500 0.7rem/1 var(--font-body);
    letter-spacing: 0.08em; text-transform: uppercase; transition: background .15s, color .15s; }
  .lang-btn + .lang-btn { border-left: 1px solid var(--border); }
  .lang-btn.active { background: var(--primary); color: var(--on-primary); }
  main { max-width: 480px; margin: 0 auto; padding: 1.75rem 1rem 3rem; }
  .eyebrow { font-size: 0.72rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .event-title { font-family: var(--font-heading); font-weight: 800; font-size: clamp(1.7rem, 7vw, 2.2rem); line-height: 1.1; letter-spacing: -0.02em; margin: 0.35rem 0 0.3rem; }
  .event-date { color: var(--muted); font-size: 0.9rem; }

  .rating { display: flex; flex-direction: column; align-items: center; margin: 1.75rem 0 1.5rem; }
  .dial { --c: var(--badge-ai); --c-bg: var(--badge-ai-bg); width: 9.5rem; height: 9.5rem; border-radius: 50%;
    display: grid; place-items: center; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
    background: var(--c-bg); border: 2px solid color-mix(in srgb, var(--c) 35%, transparent); color: var(--c);
    transition: background .3s, border-color .3s, color .3s, box-shadow .15s; }
  .dial:active { cursor: grabbing; }
  .dial:focus-visible { outline: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 30%, transparent); }
  .dial[data-rating="side"] { --c: var(--badge-lead); --c-bg: var(--badge-lead-bg); }
  .dial[data-rating="down"] { --c: var(--badge-ux); --c-bg: var(--badge-ux-bg); }
  .thumb-rot { transform: rotate(var(--rot, 0deg)); transition: transform .45s cubic-bezier(.175,.885,.32,1.275); }
  .dial.dragging .thumb-rot { transition: none; }
  .thumb-wiggle { display: block; }
  .dial:not(.touched) .thumb-wiggle { animation: wiggle 2.6s ease-in-out .6s infinite; }
  .thumb-wiggle svg { display: block; width: 4.5rem; height: 4.5rem; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  @keyframes wiggle { 0%, 45%, 100% { transform: rotate(0); } 10% { transform: rotate(-16deg); } 22% { transform: rotate(12deg); } 32% { transform: rotate(-5deg); } }
  @media (prefers-reduced-motion: reduce) { .dial:not(.touched) .thumb-wiggle { animation: none; } .thumb-rot { transition: none; } }
  .rating-label { margin-top: 1rem; min-height: 3.1em; text-align: center; font-family: var(--font-heading); font-size: 1.2rem; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
  .hint { color: var(--muted); font-size: 0.82rem; transition: opacity .3s; }
  .rating.touched .hint { opacity: 0; }

  form { display: flex; flex-direction: column; gap: 1.1rem; }
  .form-group { display: flex; flex-direction: column; gap: 0.3rem; }
  label { font-size: 0.85rem; font-weight: 500; color: var(--muted); }
  input, textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 0.5rem; color: var(--text);
    font-family: inherit; font-size: 1rem; padding: 0.65rem 0.8rem; width: 100%; transition: border-color .15s, box-shadow .15s; }
  input:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 20%, transparent); outline: none; }
  textarea { resize: vertical; min-height: 8rem; line-height: 1.5; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .btn { background: var(--primary); border: none; border-radius: 0.3rem; color: var(--on-primary); cursor: pointer;
    font: 600 1rem var(--font-body); padding: 0.85rem 1.25rem; width: 100%; transition: background .15s, opacity .15s; }
  .btn:not(:disabled):hover { background: var(--primary-hover); }
  .btn:disabled { opacity: .6; cursor: progress; }
  .form-error { color: var(--danger); font-size: 0.875rem; }
  .form-error:empty { display: none; }

  .done { text-align: center; padding: 2.5rem 0 1rem; }
  .done svg { width: 3rem; height: 3rem; stroke: var(--primary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; animation: pop .45s .1s cubic-bezier(.175,.885,.32,1.275) both; }
  .done h2 { font-family: var(--font-heading); font-size: 1.5rem; margin: 0.75rem 0 0.4rem; }
  .done p { color: var(--muted); margin-bottom: 1.25rem; }
  a, .link { color: var(--primary); text-decoration: none; background: none; border: none; font: inherit; cursor: pointer; }
  a:hover, .link:hover { text-decoration: underline; }
  @keyframes pop { from { transform: scale(0) rotate(-25deg); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .notice h2 { font-family: var(--font-heading); font-weight: 800; font-size: 2rem; line-height: 1.1; margin: 0.35rem 0 0.9rem; }
  .notice p { color: var(--muted); margin-bottom: 0.9rem; line-height: 1.6; }
`;

// Lucide "thumbs-up" (ISC license).
const THUMB_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatEventDate(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function shell(lang: Lang, title: string, body: string, withLangSwitch: boolean): string {
  const t = STRINGS[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="https://book.ecke.lt/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="https://book.ecke.lt/apple-touch-icon.png">
<style>${FALLBACK_TOKENS}</style>
<link rel="stylesheet" href="https://book.ecke.lt/styles.css">
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1 data-i18n="pageTitle">${t.pageTitle}</h1>
  ${withLangSwitch ? `<div class="lang-switch" role="group" aria-label="Language">
    <button type="button" class="lang-btn${lang === "de" ? " active" : ""}" data-lang="de" aria-pressed="${lang === "de"}" aria-label="Deutsch">DE</button>
    <button type="button" class="lang-btn${lang === "en" ? " active" : ""}" data-lang="en" aria-pressed="${lang === "en"}" aria-label="English">EN</button>
  </div>` : ""}
</header>
<main>
${body}
</main>
</body>
</html>`;
}

export function renderFeedbackNotice(
  lang: Lang,
  kind: "notFound" | "closed",
  event?: FeedbackEvent,
): string {
  const t = STRINGS[lang];
  const heading = kind === "closed" ? t.closedTitle : t.notFoundTitle;
  const text = kind === "closed" ? t.closedText : t.notFoundText;
  return shell(lang, `${heading} – Feedback`, `<section class="notice">
  ${event ? `<p class="eyebrow">${escapeHtml(event.title)}</p>` : ""}
  <h2>${heading}</h2>
  <p>${text}</p>
  <p><a href="/">${t.generalLink} →</a></p>
</section>`, false);
}

export function renderFeedbackForm(opts: {
  lang: Lang;
  slug: string | null;
  event: FeedbackEvent | null;
}): string {
  const { lang, slug, event } = opts;
  const t = STRINGS[lang];
  const title = event ? event.title : null;
  const dates = event
    ? { de: formatEventDate(event.date, "de"), en: formatEventDate(event.date, "en") }
    : null;
  const config = { lang, slug, strings: STRINGS, dates, maxText: MAX_TEXT };
  // Escape "<" so no string in the config can close the script tag early.
  const configJson = JSON.stringify(config).replace(/</g, "\\u003c");

  const intro = title
    ? `<p class="eyebrow" data-i18n="eyebrowEvent">${t.eyebrowEvent}</p>
  <h2 class="event-title">${escapeHtml(title)}</h2>
  <p class="event-date" id="eventDate">${dates![lang]}</p>`
    : `<p class="eyebrow" data-i18n="eyebrowGeneral">${t.eyebrowGeneral}</p>
  <h2 class="event-title" data-i18n="generalTitle">${t.generalTitle}</h2>`;

  const body = `<section id="formView">
  ${intro}
  <div class="rating" id="rating">
    <div class="dial" id="dial" role="slider" tabindex="0" data-rating="up"
      aria-label="${t.dialLabel}" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0" aria-valuetext="${t.ratingUp}">
      <span class="thumb-rot"><span class="thumb-wiggle">${THUMB_SVG}</span></span>
    </div>
    <p class="rating-label" id="ratingLabel" aria-hidden="true">${t.ratingUp}</p>
    <p class="hint" data-i18n="hint">${t.hint}</p>
  </div>
  <form id="form" novalidate>
    <div class="form-group">
      <label for="text" id="textLabel">${t.textLabel}</label>
      <textarea id="text" name="text" rows="5" maxlength="${MAX_TEXT}" placeholder="${t.placeholderUp}"></textarea>
    </div>
    <div class="form-group">
      <label for="name" data-i18n="nameLabel">${t.nameLabel}</label>
      <input id="name" name="name" type="text" maxlength="${MAX_NAME}" autocomplete="name" placeholder="${t.namePlaceholder}" data-i18n-placeholder="namePlaceholder">
    </div>
    <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
    <p class="form-error" id="error" role="alert"></p>
    <button class="btn" type="submit" id="send" data-i18n="send">${t.send}</button>
  </form>
</section>
<section class="done" id="doneView" hidden>
  ${CHECK_SVG}
  <h2 data-i18n="thanksTitle">${t.thanksTitle}</h2>
  <p data-i18n="thanksText">${t.thanksText}</p>
  <button type="button" class="link" id="again" data-i18n="again">${t.again}</button>
</section>
<script>const CONFIG = ${configJson};</script>
<script>${CLIENT_JS}</script>`;

  return shell(lang, title ? `Feedback – ${title}` : t.pageTitle, body, true);
}

// Client-side behaviour: the rotatable thumb, language switch and submit.
// Kept as plain ES2017 in a string so the worker ships a single HTML response.
const CLIENT_JS = `
(function () {
  var RATINGS = ["up", "side", "down"];
  var ANGLES = [0, 90, 180];
  var LABEL_KEYS = ["ratingUp", "ratingSide", "ratingDown"];
  var PLACEHOLDER_KEYS = ["placeholderUp", "placeholderSide", "placeholderDown"];
  var lang = CONFIG.lang;
  var idx = 0;

  var dial = document.getElementById("dial");
  var rot = dial.querySelector(".thumb-rot");
  var rating = document.getElementById("rating");
  var label = document.getElementById("ratingLabel");
  var text = document.getElementById("text");
  var textLabel = document.getElementById("textLabel");
  var form = document.getElementById("form");
  var error = document.getElementById("error");
  var send = document.getElementById("send");

  function t(key) { return CONFIG.strings[lang][key]; }

  function render() {
    dial.dataset.rating = RATINGS[idx];
    rot.style.setProperty("--rot", ANGLES[idx] + "deg");
    label.textContent = t(LABEL_KEYS[idx]);
    dial.setAttribute("aria-valuenow", String(idx));
    dial.setAttribute("aria-valuetext", t(LABEL_KEYS[idx]));
    dial.setAttribute("aria-label", t("dialLabel"));
    text.placeholder = t(PLACEHOLDER_KEYS[idx]);
    textLabel.textContent = t(idx === 2 ? "textLabelRequired" : "textLabel");
    if (idx !== 2 && error.dataset.key === "errReason") clearError();
  }

  function touch() {
    dial.classList.add("touched");
    rating.classList.add("touched");
  }

  function setIdx(i) { idx = Math.max(0, Math.min(2, i)); touch(); render(); }

  function showError(key) { error.dataset.key = key; error.textContent = t(key); }
  function clearError() { delete error.dataset.key; error.textContent = ""; }

  // Drag to rotate: the thumb follows the finger around the dial's centre
  // (0° = up, 90° = sideways, 180° = down) and snaps to the nearest stop on
  // release. A press without real movement counts as a tap and cycles.
  var drag = null;
  function pointerAngle(e) {
    var r = dial.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2);
    var dy = e.clientY - (r.top + r.height / 2);
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }
  dial.addEventListener("pointerdown", function (e) {
    dial.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, a0: pointerAngle(e), base: ANGLES[idx], cur: ANGLES[idx], moved: false };
    touch();
  });
  dial.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    if (!drag.moved) { drag.moved = true; dial.classList.add("dragging"); }
    var delta = pointerAngle(e) - drag.a0;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.cur = Math.max(-20, Math.min(200, drag.base + delta));
    rot.style.setProperty("--rot", drag.cur + "deg");
    var live = Math.max(0, Math.min(2, Math.round(drag.cur / 90)));
    if (live !== idx) { idx = live; dial.dataset.rating = RATINGS[idx]; label.textContent = t(LABEL_KEYS[idx]); }
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    dial.classList.remove("dragging");
    if (d.moved) setIdx(Math.round(d.cur / 90));
    else setIdx((idx + 1) % 3);
  }
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);

  dial.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") setIdx(idx + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp") setIdx(idx - 1);
    else if (k === "Home") setIdx(0);
    else if (k === "End") setIdx(2);
    else if (k === "Enter" || k === " ") setIdx((idx + 1) % 3);
    else return;
    e.preventDefault();
  });

  function setLang(next) {
    lang = next;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var on = b.dataset.lang === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    var date = document.getElementById("eventDate");
    if (date && CONFIG.dates) date.textContent = CONFIG.dates[lang];
    if (error.dataset.key) error.textContent = t(error.dataset.key);
    render();
  }
  document.querySelectorAll(".lang-btn").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });

  var ERRORS = { reason_required: "errReason", too_long: "errTooLong", closed: "errClosed", unknown_event: "errClosed" };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();
    var body = {
      slug: CONFIG.slug,
      rating: RATINGS[idx],
      text: text.value.trim(),
      name: document.getElementById("name").value.trim(),
      lang: lang,
      website: document.getElementById("website").value,
    };
    if (body.rating === "down" && !body.text) { showError("errReason"); text.focus(); return; }
    send.disabled = true;
    send.textContent = t("sending");
    fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        if (res.ok) return done();
        return res.json().catch(function () { return {}; }).then(function (data) {
          showError(ERRORS[data.error] || "errGeneric");
        });
      })
      .catch(function () { showError("errGeneric"); })
      .then(function () { send.disabled = false; send.textContent = t("send"); });
  });

  function done() {
    document.getElementById("formView").hidden = true;
    document.getElementById("doneView").hidden = false;
    window.scrollTo(0, 0);
  }
  document.getElementById("again").addEventListener("click", function () {
    text.value = "";
    document.getElementById("doneView").hidden = true;
    document.getElementById("formView").hidden = false;
    text.focus();
  });

  render();
})();
`;
