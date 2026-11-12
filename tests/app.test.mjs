// Test end-to-end: server vero su porta casuale, database temporaneo, nessuna email reale.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "approdo-test-"));
process.env.DATA_MODE = "live";
process.env.ADMIN_PASSWORD = "password-di-prova-123";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ICAL_FEED_KEY = "chiave-feed-di-prova";
process.env.SMTP_HOST = "";
process.env.NOTIFY_EMAIL_TO = "gestore@example.com";

const { createApp } = await import("../server.mjs");
const { addDays, todayRome } = await import("../src/dates.mjs");

let server, db, base;
before(async () => {
  ({ server, db } = createApp({ dbPath: path.join(dir, "t.db"), startJobs: false }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.SITE_URL = base;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const T = todayRome();
const req = (over = {}) => ({ lang: "it", roomId: "libeccio", checkIn: addDays(T, 10), checkOut: addDays(T, 13), arrival: "16:00", guests: 2, name: "Giulia Rossi", email: "giulia@example.com", phone: "+39 333 1234567", note: "", ...over });
const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": String(Math.random()) }, body: JSON.stringify(body) });

async function login() {
  const r = await fetch(base + "/gestione/accesso", { method: "POST", body: new URLSearchParams({ password: process.env.ADMIN_PASSWORD }), redirect: "manual" });
  assert.equal(r.status, 303);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const page = await (await fetch(base + "/gestione", { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
  return { cookie, csrf };
}

test("il sito pubblico si apre in italiano e in inglese", async () => {
  const it = await (await fetch(base + "/?lang=it")).text();
  assert.match(it, /Casa Libeccio/);
  assert.match(it, /Invia richiesta di prenotazione/);
  const en = await (await fetch(base + "/?lang=en")).text();
  assert.match(en, /Send booking request/);
});

test("le disponibilità non contengono dati personali", async () => {
  const a = await (await fetch(base + "/api/disponibilita")).json();
  assert.equal(a.rooms.length, 3);
  assert.ok(a.settings.slots.includes("15:00") && a.settings.slots.includes("20:00"));
  assert.ok(!JSON.stringify(a).includes("@"));
});

test("richiesta → conferma del gestore → date occupate, niente doppie prenotazioni", async () => {
  const r = await post("/api/richieste", req());
  assert.equal(r.status, 201);
  const { link } = await r.json();
  assert.match(link, /^\/richiesta\//);

  // il gestore riceve la notifica (registrata come non inviata perché SMTP è vuoto)
  assert.ok(db.notifications().some((n) => n.recipient === "gestore@example.com" && n.subject.startsWith("Nuova richiesta")));

  // una seconda richiesta sulle stesse date è ancora possibile finché la prima non è confermata
  const r2 = await post("/api/richieste", req({ email: "altro@example.com", name: "Marco Bianchi" }));
  assert.equal(r2.status, 201);

  const { cookie, csrf } = await login();
  const [first, second] = db.pending();
  const ok = await fetch(base + `/gestione/richieste/${first.id}`, { method: "POST", headers: { cookie }, body: new URLSearchParams({ csrf, azione: "conferma", message: "A presto" }), redirect: "manual" });
  assert.equal(ok.status, 303);
  assert.equal(db.request(first.id).status, "confermata");
  assert.equal(db.isFree("libeccio", addDays(T, 10), addDays(T, 13)), false);

  // confermare la seconda sulle stesse date deve fallire
  await fetch(base + `/gestione/richieste/${second.id}`, { method: "POST", headers: { cookie }, body: new URLSearchParams({ csrf, azione: "conferma" }), redirect: "manual" });
  assert.equal(db.request(second.id).status, "in_attesa");

  // e una nuova richiesta sulle stesse date viene rifiutata dal server
  const r3 = await post("/api/richieste", req({ email: "terzo@example.com" }));
  assert.equal(r3.status, 422);

  // l'ospite vede lo stato aggiornato
  const status = await (await fetch(base + link)).text();
  assert.match(status, /Confermata/);
  assert.match(status, /A presto/);
});

test("il server rifiuta orari fuori fascia, troppi ospiti e soggiorni sotto il minimo", async () => {
  assert.equal((await post("/api/richieste", req({ checkIn: addDays(T, 30), checkOut: addDays(T, 32), arrival: "23:00" }))).status, 422);
  assert.equal((await post("/api/richieste", req({ checkIn: addDays(T, 30), checkOut: addDays(T, 32), guests: 3 }))).status, 422);
  assert.equal((await post("/api/richieste", req({ checkIn: addDays(T, 30), checkOut: addDays(T, 31) }))).status, 422);
  assert.equal((await post("/api/richieste", req({ checkIn: addDays(T, -2), checkOut: addDays(T, 1) }))).status, 422);
});

test("area gestore: senza accesso si va al login, senza csrf non si modifica nulla", async () => {
  const r = await fetch(base + "/gestione", { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/gestione/accesso");
  const bad = await fetch(base + "/gestione/accesso", { method: "POST", body: new URLSearchParams({ password: "sbagliata" }) });
  assert.equal(bad.status, 401);
  const { cookie } = await login();
  const noCsrf = await fetch(base + "/gestione/blocchi", { method: "POST", headers: { cookie }, body: new URLSearchParams({ room: "maestrale", from: addDays(T, 40), to: addDays(T, 42) }) });
  assert.equal(noCsrf.status, 403);
});

test("blocchi manuali e calendario .ics esportato", async () => {
  const { cookie, csrf } = await login();
  await fetch(base + "/gestione/blocchi", { method: "POST", headers: { cookie }, body: new URLSearchParams({ csrf, room: "maestrale", from: addDays(T, 40), to: addDays(T, 42), label: "Manutenzione" }), redirect: "manual" });
  assert.equal(db.isFree("maestrale", addDays(T, 40), addDays(T, 42)), false);
  assert.equal((await fetch(base + "/ical/maestrale.ics")).status, 404);
  const ics = await (await fetch(base + "/ical/maestrale.ics?k=chiave-feed-di-prova")).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, new RegExp("DTSTART;VALUE=DATE:" + addDays(T, 40).replace(/-/g, "")));
});

test("import iCal: le date di Booking bloccano il sito", async () => {
  const { parseIcs } = await import("../src/ical.mjs");
  const a = addDays(T, 50).replace(/-/g, ""), b = addDays(T, 53).replace(/-/g, "");
  const ev = parseIcs(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${a}\r\nDTEND;VALUE=DATE:${b}\r\nSUMMARY:CLOSED - Not available\r\nEND:VEVENT\r\nEND:VCALENDAR`);
  assert.equal(ev.length, 1);
  db.replaceImported("scirocco", "Booking", ev);
  const r = await post("/api/richieste", req({ roomId: "scirocco", checkIn: addDays(T, 51), checkOut: addDays(T, 54), guests: 3 }));
  assert.equal(r.status, 422);
  // il calendario esportato non ripete le date importate da Booking
  const ics = await (await fetch(base + "/ical/scirocco.ics?k=chiave-feed-di-prova")).text();
  assert.ok(!ics.includes(a));
});

test("l'ospite può annullare una richiesta in attesa", async () => {
  const r = await post("/api/richieste", req({ roomId: "maestrale", checkIn: addDays(T, 60), checkOut: addDays(T, 63), email: "annulla@example.com" }));
  const { link } = await r.json();
  const c = await fetch(base + link + "/annulla", { method: "POST", redirect: "manual" });
  assert.equal(c.status, 303);
  assert.match(await (await fetch(base + link)).text(), /Annullata/);
});
