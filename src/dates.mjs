/** Date come stringhe YYYY-MM-DD; le notti vanno da check-in (incluso) a check-out (escluso). */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(s, n) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}

export function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

/** Oggi a Roma, indipendentemente dal fuso del server. */
export function todayRome(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Orari a passi di 30 minuti tra due orari inclusi. */
export function timeSlots(from, to) {
  const out = [];
  let [h, m] = from.split(":").map(Number);
  const [eh, em] = to.split(":").map(Number);
  let guard = 0;
  while ((h < eh || (h === eh && m <= em)) && guard++ < 48) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) { m -= 60; h++; }
  }
  return out;
}

export function fmtDate(s, lang = "it", opt = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(s + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { timeZone: "UTC", ...opt });
}
