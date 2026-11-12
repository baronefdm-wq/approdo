import { isDate } from "./dates.mjs";

/** Legge gli eventi (solo date) da un calendario iCal di Booking, Airbnb e simili. */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  let ev = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) ev = {};
    else if (/^END:VEVENT/i.test(line)) {
      if (ev && isDate(ev.start) && isDate(ev.end) && ev.end > ev.start) out.push(ev);
      ev = null;
    } else if (ev) {
      const m = line.match(/^(DTSTART|DTEND|SUMMARY)[^:]*:(.*)$/i);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const val = m[2].trim();
      if (key === "SUMMARY") ev.summary = val.replace(/\\[,;n]/g, " ").slice(0, 80);
      else {
        const d = val.match(/(\d{4})(\d{2})(\d{2})/);
        if (d) ev[key === "DTSTART" ? "start" : "end"] = `${d[1]}-${d[2]}-${d[3]}`;
      }
    }
  }
  return out;
}

/** Calendario delle notti occupate di una camera, da caricare su Booking e Airbnb. */
export function buildIcs({ name, roomId, stays, host }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//Approdo//${name}//IT`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const s of stays) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${s.check_in.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${s.check_out.replace(/-/g, "")}`,
      `SUMMARY:${name} - ${roomId} - Non disponibile`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Scarica un calendario da un link https (Booking o Airbnb). */
export async function fetchIcs(url) {
  if (!/^https:\/\//i.test(url)) throw new Error("Il link deve iniziare con https://");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Approdo-calendar-sync/0.1" } });
    if (!res.ok) throw new Error(`La piattaforma ha risposto ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Il link non restituisce un calendario .ics");
    return parseIcs(text);
  } finally {
    clearTimeout(t);
  }
}

/** Sincronizza tutte le camere che hanno un link iCal impostato. */
export async function syncAll(db, today) {
  const results = [];
  for (const room of db.rooms()) {
    for (const [source, url] of [["Booking", room.ical_booking], ["Airbnb", room.ical_airbnb]]) {
      if (!url) continue;
      try {
        const events = (await fetchIcs(url)).filter((e) => e.end > today);
        const r = db.replaceImported(room.id, source, events);
        db.setSyncResult(room.id, r.clashes ? `${r.clashes} date di ${source} si sovrappongono a prenotazioni del sito` : null);
        results.push({ room: room.id, source, ...r });
      } catch (e) {
        db.setSyncResult(room.id, `${source}: ${e.message}`);
        results.push({ room: room.id, source, error: e.message });
      }
    }
  }
  return results;
}
