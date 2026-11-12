import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { addDays, nightsBetween, todayRome } from "./dates.mjs";

/**
 * Archivio su SQLite (modulo integrato in Node.js). Un file, una sola istanza
 * dell'applicazione: su Render serve un disco permanente montato su /data.
 *
 * Tabelle:
 * - rooms: prezzo corrente e link iCal per camera (la descrizione sta in config/struttura.json)
 * - settings: orari e regole modificabili dal gestore
 * - requests: richieste degli ospiti (dati personali: le vede solo il gestore)
 * - stays: notti occupate (prenotazioni confermate, blocchi, calendari importati)
 * - notifications: registro delle email inviate o non inviate
 */
export function openDb(file, struttura, { demo = false } = {}) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, price INTEGER NOT NULL,
      ical_booking TEXT NOT NULL DEFAULT '', ical_airbnb TEXT NOT NULL DEFAULT '',
      last_sync TEXT, last_sync_error TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL,
      nights INTEGER NOT NULL, arrival TEXT NOT NULL, guests INTEGER NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'it', total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_attesa', owner_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS requests_status ON requests(status);
    CREATE TABLE IF NOT EXISTS stays (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
      request_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stays_room ON stays(room_id, check_out);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, recipient TEXT NOT NULL,
      subject TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT ''
    );
  `);

  const now = () => new Date().toISOString();
  const insRoom = db.prepare("INSERT OR IGNORE INTO rooms (id, price) VALUES (?, ?)");
  for (const c of struttura.camere) insRoom.run(c.id, c.prezzoBase);

  const r = struttura.regole || {};
  const defaults = {
    checkInFrom: r.checkInDalle || "15:00",
    checkInTo: r.checkInFinoAlle || "20:00",
    checkOutBy: r.checkOutEntro || "10:30",
    minNights: String(r.nottiMinime || 1),
    discount: String(r.scontoDiretto ?? 0),
    maxAdvanceDays: String(r.anticipoMassimoGiorni || 365),
  };
  const insSet = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(defaults)) insSet.run(k, v);

  // Dati d'esempio solo in modalità demo e solo la prima volta.
  if (demo && db.prepare("SELECT COUNT(*) n FROM stays").get().n === 0) {
    const t = todayRome();
    const ids = struttura.camere.map((c) => c.id);
    const ex = [
      [ids[0], 3, 5, "Esempio: prenotazione telefonica"],
      [ids[1 % ids.length], 9, 12, "Esempio: occupato su un portale"],
      [ids[2 % ids.length], 16, 20, "Esempio: occupato su un portale"],
    ];
    const ins = db.prepare("INSERT INTO stays (id, room_id, check_in, check_out, kind, source, label, created_at) VALUES (?, ?, ?, ?, 'blocco', 'Esempio', ?, ?)");
    for (const [room, a, b, label] of ex) ins.run(randomUUID(), room, addDays(t, a), addDays(t, b), label, now());
  }

  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const out = fn(); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  const api = {
    raw: db,
    close: () => db.close(),

    settings() {
      const s = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((x) => [x.key, x.value]));
      return { ...s, minNights: Number(s.minNights), discount: Number(s.discount), maxAdvanceDays: Number(s.maxAdvanceDays) };
    },
    saveSettings(s) {
      const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      tx(() => { for (const [k, v] of Object.entries(s)) up.run(k, String(v)); });
    },

    rooms() { return db.prepare("SELECT * FROM rooms").all(); },
    room(id) { return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id); },
    setPrice(id, price) { db.prepare("UPDATE rooms SET price = ? WHERE id = ?").run(price, id); },
    setIcal(id, booking, airbnb) { db.prepare("UPDATE rooms SET ical_booking = ?, ical_airbnb = ? WHERE id = ?").run(booking, airbnb, id); },
    setSyncResult(id, error) { db.prepare("UPDATE rooms SET last_sync = ?, last_sync_error = ? WHERE id = ?").run(now(), error || null, id); },

    /** Notti occupate di una camera da una data in poi (nessun dato personale). */
    busy(roomId, from) {
      return db.prepare("SELECT check_in, check_out FROM stays WHERE room_id = ? AND check_out > ? ORDER BY check_in").all(roomId, from);
    },
    stays(from, to) {
      return db.prepare("SELECT * FROM stays WHERE check_out > ? AND check_in < ? ORDER BY check_in").all(from, to);
    },
    staysForRoom(roomId, from) {
      return db.prepare("SELECT * FROM stays WHERE room_id = ? AND check_out > ? ORDER BY check_in").all(roomId, from);
    },
    isFree(roomId, a, b, ignoreId = "") {
      return !db.prepare("SELECT 1 FROM stays WHERE room_id = ? AND check_in < ? AND ? < check_out AND id != ? LIMIT 1").get(roomId, b, a, ignoreId);
    },

    addBlock(roomId, a, b, label) {
      return tx(() => {
        if (!api.isFree(roomId, a, b)) return { ok: false, error: "occupato" };
        const id = randomUUID();
        db.prepare("INSERT INTO stays (id, room_id, check_in, check_out, kind, source, label, created_at) VALUES (?, ?, ?, ?, 'blocco', 'Manuale', ?, ?)").run(id, roomId, a, b, label, now());
        return { ok: true, id };
      });
    },
    removeStay(id) {
      return tx(() => {
        const s = db.prepare("SELECT * FROM stays WHERE id = ?").get(id);
        if (!s) return null;
        if (s.source === "Booking" || s.source === "Airbnb") return { ...s, refused: true };
        db.prepare("DELETE FROM stays WHERE id = ?").run(id);
        if (s.request_id) db.prepare("UPDATE requests SET status = 'annullata', decided_at = ? WHERE id = ?").run(now(), s.request_id);
        return s;
      });
    },
    /** Sostituisce le date importate da una piattaforma per una camera. */
    replaceImported(roomId, source, events) {
      return tx(() => {
        db.prepare("DELETE FROM stays WHERE room_id = ? AND source = ?").run(roomId, source);
        const ins = db.prepare("INSERT INTO stays (id, room_id, check_in, check_out, kind, source, label, created_at) VALUES (?, ?, ?, ?, 'blocco', ?, ?, ?)");
        let clashes = 0;
        for (const e of events) {
          if (db.prepare("SELECT 1 FROM stays WHERE room_id = ? AND source = 'Sito' AND check_in < ? AND ? < check_out LIMIT 1").get(roomId, e.end, e.start)) clashes++;
          ins.run(randomUUID(), roomId, e.start, e.end, source, e.summary || `Occupato su ${source}`, now());
        }
        return { imported: events.length, clashes };
      });
    },

    createRequest(d) {
      const id = randomUUID();
      const token = randomBytes(18).toString("base64url");
      db.prepare(`INSERT INTO requests (id, token, room_id, check_in, check_out, nights, arrival, guests, name, email, phone, note, lang, total, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_attesa', ?)`)
        .run(id, token, d.roomId, d.checkIn, d.checkOut, nightsBetween(d.checkIn, d.checkOut), d.arrival, d.guests, d.name, d.email, d.phone, d.note, d.lang, d.total, now());
      return api.request(id);
    },
    request(id) { return db.prepare("SELECT * FROM requests WHERE id = ?").get(id); },
    requestByToken(token) { return db.prepare("SELECT * FROM requests WHERE token = ?").get(token); },
    pending() { return db.prepare("SELECT * FROM requests WHERE status = 'in_attesa' ORDER BY created_at").all(); },
    recentRequests(limit = 30) { return db.prepare("SELECT * FROM requests WHERE status != 'in_attesa' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT ?").all(limit); },

    /** Conferma: controllo e inserimento nella stessa transazione, così non esistono doppie prenotazioni. */
    confirm(id, message = "") {
      return tx(() => {
        const r = api.request(id);
        if (!r || r.status !== "in_attesa") return { ok: false, error: "gestita" };
        if (!api.isFree(r.room_id, r.check_in, r.check_out)) return { ok: false, error: "occupato" };
        db.prepare("INSERT INTO stays (id, room_id, check_in, check_out, kind, source, label, request_id, created_at) VALUES (?, ?, ?, ?, 'prenotazione', 'Sito', ?, ?, ?)")
          .run(randomUUID(), r.room_id, r.check_in, r.check_out, r.name, r.id, now());
        db.prepare("UPDATE requests SET status = 'confermata', decided_at = ?, owner_message = ? WHERE id = ?").run(now(), message, id);
        return { ok: true, request: api.request(id) };
      });
    },
    reject(id, message = "") {
      return tx(() => {
        const r = api.request(id);
        if (!r || r.status !== "in_attesa") return { ok: false, error: "gestita" };
        db.prepare("UPDATE requests SET status = 'rifiutata', decided_at = ?, owner_message = ? WHERE id = ?").run(now(), message, id);
        return { ok: true, request: api.request(id) };
      });
    },
    cancelByGuest(token) {
      return tx(() => {
        const r = api.requestByToken(token);
        if (!r || r.status !== "in_attesa") return null;
        db.prepare("UPDATE requests SET status = 'annullata', decided_at = ? WHERE id = ?").run(now(), r.id);
        return api.request(r.id);
      });
    },
    countRecentFromEmail(email, sinceIso) {
      return db.prepare("SELECT COUNT(*) n FROM requests WHERE email = ? AND created_at > ?").get(email, sinceIso).n;
    },

    logNotification(recipient, subject, status, error = "") {
      db.prepare("INSERT INTO notifications (id, created_at, recipient, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), now(), recipient, subject, status, error);
    },
    notifications(limit = 15) { return db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit); },
  };
  return api;
}
