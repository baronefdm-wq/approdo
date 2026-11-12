import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ROOT, env, checkEnv, loadStruttura } from "./src/config.mjs";
import { openDb } from "./src/db.mjs";
import { addDays, isDate, isTime, nightsBetween, timeSlots, todayRome } from "./src/dates.mjs";
import { buildIcs, syncAll } from "./src/ical.mjs";
import { send, ownerNewRequest, guestReceived, guestDecision } from "./src/email.mjs";
import { checkPassword, checkCsrf, clearCookie, csrfToken, parseCookies, rateLimiter, session, sessionCookie } from "./src/auth.mjs";
import { sitePage, requestPage } from "./src/views/site.mjs";
import { loginPage, dashboard, settingsPage } from "./src/views/admin.mjs";

const MIME = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function createApp({ struttura = loadStruttura(), dbPath = env.dbPath, startJobs = true } = {}) {
  const db = openDb(dbPath, struttura, { demo: env.dataMode === "demo" });
  const loginLimit = rateLimiter(10, 15 * 60e3);
  const requestLimit = rateLimiter(5, 10 * 60e3);
  const flashes = new Map();

  const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const ipKey = (req) => createHash("sha256").update(ip(req)).digest("hex").slice(0, 16);

  function send_(res, status, body, headers = {}) {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "x-frame-options": "DENY",
      ...headers,
    });
    res.end(body);
  }
  const json = (res, status, obj) => send_(res, status, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  const redirect = (res, to, headers = {}) => send_(res, 303, "", { location: to, ...headers });

  async function readBody(req, limit = 20000) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks).toString("utf8");
  }
  async function form(req) { return Object.fromEntries(new URLSearchParams(await readBody(req))); }

  function langOf(req, url) {
    const q = url.searchParams.get("lang");
    if (q === "en" || q === "it") return q;
    const c = parseCookies(req).lang;
    if (c === "en" || c === "it") return c;
    return /^en\b/i.test(req.headers["accept-language"] || "") ? "en" : "it";
  }

  function availability() {
    const today = todayRome();
    const st = db.settings();
    const rooms = db.rooms();
    return {
      today, maxDate: addDays(today, st.maxAdvanceDays),
      settings: { checkInFrom: st.checkInFrom, checkInTo: st.checkInTo, checkOutBy: st.checkOutBy, minNights: st.minNights, discount: st.discount, slots: timeSlots(st.checkInFrom, st.checkInTo) },
      rooms: struttura.camere.map((c) => ({
        id: c.id, name: c.nome, max: c.ospitiMax,
        price: rooms.find((r) => r.id === c.id)?.price ?? c.prezzoBase,
        busy: db.busy(c.id, today).map((b) => [b.check_in, b.check_out]),
      })),
    };
  }

  /** Validazione completa sul server: le stesse regole del calendario, più antispam. */
  function validateRequest(b) {
    const errs = [];
    const lang = b.lang === "en" ? "en" : "it";
    const m = (it, en) => (lang === "en" ? en : it);
    const room = struttura.camere.find((c) => c.id === b.roomId);
    const st = db.settings();
    const today = todayRome();
    if (!room) errs.push(m("Camera non valida.", "Invalid room."));
    if (!isDate(b.checkIn) || !isDate(b.checkOut) || b.checkOut <= b.checkIn) errs.push(m("Date non valide.", "Invalid dates."));
    else {
      if (b.checkIn < today) errs.push(m("L'arrivo non può essere nel passato.", "Check-in can't be in the past."));
      if (b.checkOut > addDays(today, st.maxAdvanceDays)) errs.push(m("Date troppo lontane: scrivici per periodi così avanti.", "Dates too far ahead: please contact us."));
      if (nightsBetween(b.checkIn, b.checkOut) < st.minNights) errs.push(m(`Il soggiorno minimo è di ${st.minNights} notti.`, `The minimum stay is ${st.minNights} nights.`));
      if (nightsBetween(b.checkIn, b.checkOut) > 60) errs.push(m("Per soggiorni oltre 60 notti scrivici.", "For stays over 60 nights please contact us."));
    }
    if (!isTime(b.arrival) || !timeSlots(st.checkInFrom, st.checkInTo).includes(b.arrival)) errs.push(m("Scegli un orario di arrivo nella fascia del check-in.", "Choose an arrival time within check-in hours."));
    const guests = Number(b.guests);
    if (!Number.isInteger(guests) || guests < 1 || (room && guests > room.ospitiMax)) errs.push(m("Numero di ospiti non valido per questa camera.", "Invalid number of guests for this room."));
    const name = String(b.name || "").trim().slice(0, 80);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 120);
    const phone = String(b.phone || "").trim().slice(0, 30);
    const note = String(b.note || "").trim().slice(0, 300);
    if (name.length < 2) errs.push(m("Inserisci nome e cognome.", "Please enter your full name."));
    if (!EMAIL_RE.test(email)) errs.push(m("Inserisci un'email valida: ti scriviamo lì la conferma.", "Please enter a valid email: we send the confirmation there."));
    if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) errs.push(m("Il telefono non sembra valido.", "The phone number doesn't look valid."));
    if (!errs.length && !db.isFree(room.id, b.checkIn, b.checkOut)) errs.push(m("Queste date non sono più libere. Scegline altre.", "These dates are no longer available. Please pick others."));
    const price = db.room(b.roomId)?.price ?? room?.prezzoBase ?? 0;
    const total = errs.length ? 0 : Math.round(nightsBetween(b.checkIn, b.checkOut) * price * (1 - st.discount / 100));
    return { errs, data: { roomId: b.roomId, checkIn: b.checkIn, checkOut: b.checkOut, arrival: b.arrival, guests, name, email, phone, note, lang, total } };
  }

  function admin(req, res) {
    const sid = session(req);
    if (!sid) { redirect(res, "/gestione/accesso"); return null; }
    return sid;
  }
  function takeFlash(sid) { const f = flashes.get(sid); flashes.delete(sid); return f; }
  function setFlash(sid, type, text) { flashes.set(sid, { type, text }); if (flashes.size > 500) flashes.clear(); }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const method = req.method;

    // File statici
    if (method === "GET" && (p === "/style.css" || p === "/prenota.js" || p.startsWith("/foto/"))) {
      const file = path.normalize(path.join(ROOT, "public", p));
      if (!file.startsWith(path.join(ROOT, "public"))) return send_(res, 404, "Non trovato");
      try { return send_(res, 200, await readFile(file), { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "public, max-age=3600" }); }
      catch { return send_(res, 404, "Non trovato"); }
    }

    if (method === "GET" && p === "/salute") return json(res, 200, { ok: true, mode: env.dataMode });
    if (method === "GET" && p === "/robots.txt") return send_(res, 200, "User-agent: *\nDisallow: /gestione\nDisallow: /richiesta/\nDisallow: /ical/\n", { "content-type": "text/plain" });

    // Sito pubblico
    if (method === "GET" && p === "/") {
      const lang = langOf(req, url);
      return send_(res, 200, sitePage(struttura, db, lang), { "set-cookie": `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax` });
    }
    if (method === "GET" && p === "/api/disponibilita") return json(res, 200, availability());

    if (method === "POST" && p === "/api/richieste") {
      let b;
      try { b = JSON.parse(await readBody(req, 5000)); } catch { return json(res, 400, { ok: false, errors: ["Richiesta non valida."] }); }
      if (b.website) return json(res, 200, { ok: true }); // campo trappola per i bot
      if (!requestLimit(ipKey(req))) return json(res, 429, { ok: false, errors: [b.lang === "en" ? "Too many requests. Please try again later." : "Troppe richieste in poco tempo. Riprova più tardi."] });
      const { errs, data } = validateRequest(b);
      if (errs.length) return json(res, 422, { ok: false, errors: errs });
      if (db.countRecentFromEmail(data.email, new Date(Date.now() - 864e5).toISOString()) >= 5) return json(res, 429, { ok: false, errors: [data.lang === "en" ? "You already sent several requests today: we'll reply soon." : "Hai già inviato diverse richieste oggi: ti rispondiamo a breve."] });
      const r = db.createRequest(data);
      json(res, 201, { ok: true, link: `/richiesta/${r.token}` });
      // Email dopo la risposta, così l'ospite non aspetta il server di posta.
      const owner = ownerNewRequest(struttura, r);
      for (const to of env.notifyTo) await send(db, { to, ...owner, replyTo: r.email });
      if (!env.notifyTo.length) db.logNotification("(gestore)", owner.subject, "non inviata", "NOTIFY_EMAIL_TO non impostato");
      await send(db, { to: r.email, ...guestReceived(struttura, r), replyTo: struttura.contatti?.email });
      return;
    }

    const reqMatch = p.match(/^\/richiesta\/([A-Za-z0-9_-]{20,40})(\/annulla)?$/);
    if (reqMatch) {
      const r = db.requestByToken(reqMatch[1]);
      if (!r) return send_(res, 404, "Richiesta non trovata", { "content-type": "text/plain; charset=utf-8" });
      if (method === "POST" && reqMatch[2]) {
        const done = db.cancelByGuest(r.token);
        if (done) for (const to of env.notifyTo) await send(db, { to, subject: `Richiesta annullata dall'ospite: ${r.name}`, text: `${r.name} ha annullato la richiesta per ${r.check_in} → ${r.check_out}.` });
        return redirect(res, `/richiesta/${r.token}`);
      }
      if (method === "GET" && !reqMatch[2]) return send_(res, 200, requestPage(struttura, r), { "cache-control": "no-store" });
    }

    const ics = p.match(/^\/ical\/([a-z0-9-]{1,40})\.ics$/);
    if (method === "GET" && ics) {
      if (!env.feedKey || url.searchParams.get("k") !== env.feedKey) return send_(res, 404, "Non trovato");
      const room = struttura.camere.find((c) => c.id === ics[1]);
      if (!room) return send_(res, 404, "Non trovato");
      // Esporta solo ciò che non viene dalla stessa piattaforma che legge il calendario: tutto tranne gli import, per non creare cicli.
      const stays = db.staysForRoom(room.id, todayRome()).filter((x) => x.source !== "Booking" && x.source !== "Airbnb");
      return send_(res, 200, buildIcs({ name: struttura.nome, roomId: room.id, stays, host: new URL(env.siteUrl).host }), { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" });
    }

    // Area gestore
    if (p === "/gestione/accesso") {
      if (method === "GET") return send_(res, 200, loginPage(struttura));
      if (method === "POST") {
        if (!loginLimit(ipKey(req))) return send_(res, 429, loginPage(struttura, "Troppi tentativi. Riprova tra 15 minuti."));
        const f = await form(req);
        if (!checkPassword(f.password)) return send_(res, 401, loginPage(struttura, "Password non corretta."));
        return redirect(res, "/gestione", { "set-cookie": sessionCookie(req) });
      }
    }
    if (p.startsWith("/gestione")) {
      const sid = admin(req, res);
      if (!sid) return;
      const csrf = csrfToken(sid);
      if (method === "GET" && p === "/gestione") return send_(res, 200, dashboard(struttura, db, csrf, takeFlash(sid)), { "cache-control": "no-store" });
      if (method === "GET" && p === "/gestione/impostazioni") return send_(res, 200, settingsPage(struttura, db, csrf, takeFlash(sid)), { "cache-control": "no-store" });
      if (method !== "POST") return send_(res, 404, "Non trovato");
      const f = await form(req);
      if (!checkCsrf(sid, f.csrf)) return send_(res, 403, "Sessione scaduta: ricarica la pagina.", { "content-type": "text/plain; charset=utf-8" });

      if (p === "/gestione/esci") return redirect(res, "/gestione/accesso", { "set-cookie": clearCookie() });

      const dec = p.match(/^\/gestione\/richieste\/([0-9a-f-]{36})$/);
      if (dec) {
        const message = String(f.message || "").trim().slice(0, 400);
        const out = f.azione === "conferma" ? db.confirm(dec[1], message) : db.reject(dec[1], message);
        if (!out.ok) setFlash(sid, "bad", out.error === "occupato" ? "Le date non sono più libere: la richiesta non è stata confermata." : "La richiesta era già stata gestita.");
        else {
          const sent = await send(db, { to: out.request.email, ...guestDecision(struttura, out.request, db.settings()), replyTo: struttura.contatti?.email });
          setFlash(sid, "ok", `${f.azione === "conferma" ? "Prenotazione confermata" : "Richiesta rifiutata"}. ${sent ? "L'ospite ha ricevuto l'email." : "Email non inviata (vedi il registro): avvisa l'ospite a " + out.request.email + "."}`);
        }
        return redirect(res, "/gestione");
      }
      if (p === "/gestione/blocchi") {
        const room = struttura.camere.find((c) => c.id === f.room);
        if (!room || !isDate(f.from) || !isDate(f.to) || f.to <= f.from) setFlash(sid, "bad", "Scegli la camera e un periodo valido.");
        else {
          const r = db.addBlock(room.id, f.from, f.to, String(f.label || "").trim().slice(0, 60) || "Bloccato");
          setFlash(sid, r.ok ? "ok" : "bad", r.ok ? "Date bloccate." : "Nel periodo c'è già una prenotazione o un blocco.");
        }
        return redirect(res, "/gestione");
      }
      const del = p.match(/^\/gestione\/date\/([0-9a-f-]{36})\/elimina$/);
      if (del) {
        const s = db.removeStay(del[1]);
        if (!s) setFlash(sid, "bad", "Data non trovata.");
        else if (s.refused) setFlash(sid, "bad", "Le date importate da Booking o Airbnb si cambiano sulla piattaforma.");
        else {
          setFlash(sid, "ok", s.source === "Sito" ? "Prenotazione cancellata: avvisa l'ospite." : "Date sbloccate.");
        }
        return redirect(res, "/gestione");
      }
      if (p === "/gestione/impostazioni") {
        const st = { checkInFrom: f.checkInFrom, checkInTo: f.checkInTo, checkOutBy: f.checkOutBy, minNights: Number(f.minNights), discount: Number(f.discount), maxAdvanceDays: Number(f.maxAdvanceDays) };
        const ok = isTime(st.checkInFrom) && isTime(st.checkInTo) && isTime(st.checkOutBy) && st.checkInTo >= st.checkInFrom
          && Number.isInteger(st.minNights) && st.minNights >= 1 && st.minNights <= 30
          && Number.isFinite(st.discount) && st.discount >= 0 && st.discount <= 50
          && Number.isInteger(st.maxAdvanceDays) && st.maxAdvanceDays >= 30 && st.maxAdvanceDays <= 730;
        if (ok) { db.saveSettings(st); setFlash(sid, "ok", "Orari e regole salvati."); }
        else setFlash(sid, "bad", "Controlla i valori: la fine del check-in deve venire dopo l'inizio.");
        return redirect(res, "/gestione/impostazioni");
      }
      if (p === "/gestione/prezzi") {
        for (const c of struttura.camere) { const v = Number(f[`price_${c.id}`]); if (Number.isInteger(v) && v >= 10 && v <= 5000) db.setPrice(c.id, v); }
        setFlash(sid, "ok", "Prezzi salvati.");
        return redirect(res, "/gestione/impostazioni");
      }
      if (p === "/gestione/calendari") {
        const okUrl = (u) => !u || /^https:\/\/[^\s]{8,}$/.test(u);
        let bad = false;
        for (const c of struttura.camere) {
          const b = String(f[`booking_${c.id}`] || "").trim(), a = String(f[`airbnb_${c.id}`] || "").trim();
          if (!okUrl(b) || !okUrl(a)) { bad = true; continue; }
          db.setIcal(c.id, b, a);
        }
        if (bad) setFlash(sid, "bad", "Alcuni link non sono validi: devono iniziare con https://");
        else if (f.azione === "sincronizza") {
          const r = await syncAll(db, todayRome());
          const errs = r.filter((x) => x.error);
          setFlash(sid, errs.length ? "bad" : "ok", r.length ? `Sincronizzati ${r.length - errs.length} calendari${errs.length ? `, ${errs.length} con errori (vedi sotto)` : ""}.` : "Nessun link da sincronizzare.");
        } else setFlash(sid, "ok", "Link salvati.");
        return redirect(res, "/gestione/impostazioni");
      }
      return send_(res, 404, "Non trovato");
    }

    return send_(res, 404, "Pagina non trovata", { "content-type": "text/plain; charset=utf-8" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send_(res, e.status || 500, e.status === 413 ? "Richiesta troppo grande" : "Errore interno", { "content-type": "text/plain; charset=utf-8" });
    });
  });

  let timer = null;
  if (startJobs) {
    const run = () => syncAll(db, todayRome()).catch((e) => console.error("Sincronizzazione calendari:", e.message));
    timer = setInterval(run, env.syncMinutes * 60e3);
    setTimeout(run, 5000).unref();
  }
  server.on("close", () => { if (timer) clearInterval(timer); db.close(); });
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkEnv();
  if (problems.length) {
    console.error("Configurazione incompleta:\n- " + problems.join("\n- ") + "\nVedi .env.example.");
    process.exit(1);
  }
  const { server } = createApp();
  server.listen(env.port, () => console.log(`Approdo (${env.dataMode}) su ${env.siteUrl}`));
}
