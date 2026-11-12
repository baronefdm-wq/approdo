import nodemailer from "nodemailer";
import { env } from "./config.mjs";
import { fmtDate } from "./dates.mjs";

let transport = null;
function getTransport() {
  const s = env.smtp;
  if (!s.host) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.port === 465,
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    });
  }
  return transport;
}

/** Invia un'email e la registra. Se SMTP non è configurato lo scrive nel registro: nessun invio simulato. */
export async function send(db, { to, subject, text, replyTo }) {
  const t = getTransport();
  if (!t) { db.logNotification(to, subject, "non inviata", "SMTP non configurato"); return false; }
  try {
    await t.sendMail({ from: env.smtp.from, to, subject, text, replyTo });
    db.logNotification(to, subject, "inviata");
    return true;
  } catch (e) {
    db.logNotification(to, subject, "errore", String(e.message || e).slice(0, 300));
    return false;
  }
}

const roomName = (s, id, lang) => s.camere.find((c) => c.id === id)?.nome?.[lang] || id;
const eur = (n) => `${n} €`;

export function ownerNewRequest(s, r) {
  const dates = `${fmtDate(r.check_in)} → ${fmtDate(r.check_out)}`;
  return {
    subject: `Nuova richiesta: ${r.name} · ${roomName(s, r.room_id, "it")} · ${dates}`,
    text: [
      `Nuova richiesta di prenotazione dal sito di ${s.nome}.`,
      "",
      `Camera: ${roomName(s, r.room_id, "it")}`,
      `Date: ${dates} (${r.nights} notti)`,
      `Arrivo previsto: ore ${r.arrival}`,
      `Ospiti: ${r.guests}`,
      `Prezzo diretto: ${eur(r.total)}`,
      "",
      `Nome: ${r.name}`,
      `Email: ${r.email}`,
      r.phone ? `Telefono: ${r.phone}` : "",
      r.note ? `Note: ${r.note}` : "",
      r.lang === "en" ? "L'ospite ha scritto dal sito in inglese." : "",
      "",
      `Conferma o rifiuta dall'area gestore: ${env.siteUrl}/gestione`,
    ].filter((x) => x !== "").join("\n"),
  };
}

export function guestReceived(s, r) {
  const en = r.lang === "en";
  const link = `${env.siteUrl}/richiesta/${r.token}`;
  return {
    subject: en ? `${s.nome}: we received your request` : `${s.nome}: abbiamo ricevuto la tua richiesta`,
    text: (en ? [
      `Hello ${r.name},`, "",
      `thank you for your booking request at ${s.nome}.`,
      `${roomName(s, r.room_id, "en")}, ${fmtDate(r.check_in, "en")} → ${fmtDate(r.check_out, "en")}, arrival around ${r.arrival}, ${r.guests} guest(s), direct price ${eur(r.total)}.`, "",
      "This is not a confirmed booking yet: we will check and reply within 24 hours.",
      `You can check the status or cancel here: ${link}`,
    ] : [
      `Ciao ${r.name},`, "",
      `grazie per la richiesta di prenotazione a ${s.nome}.`,
      `${roomName(s, r.room_id, "it")}, dal ${fmtDate(r.check_in)} al ${fmtDate(r.check_out)}, arrivo verso le ${r.arrival}, ${r.guests} ospiti, prezzo diretto ${eur(r.total)}.`, "",
      "Non è ancora una prenotazione confermata: controlliamo e ti rispondiamo entro 24 ore.",
      `Puoi vedere lo stato o annullare qui: ${link}`,
    ]).join("\n") + `\n\n${s.nome} · ${s.contatti?.telefono || ""} · ${s.contatti?.email || ""}`,
  };
}

export function guestDecision(s, r, settings) {
  const en = r.lang === "en";
  const ok = r.status === "confermata";
  const link = `${env.siteUrl}/richiesta/${r.token}`;
  const reg = { checkInDalle: settings.checkInFrom, checkOutEntro: settings.checkOutBy };
  const lines = en
    ? [`Hello ${r.name},`, "",
      ok ? `your stay at ${s.nome} is confirmed: ${roomName(s, r.room_id, "en")}, ${fmtDate(r.check_in, "en")} → ${fmtDate(r.check_out, "en")}.` : `unfortunately we can't accept your request for ${fmtDate(r.check_in, "en")} → ${fmtDate(r.check_out, "en")}.`,
      ok ? `Check-in from ${reg.checkInDalle || "15:00"} (you told us around ${r.arrival}), check-out by ${reg.checkOutEntro || "10:30"}.` : "",
      r.owner_message ? `\nMessage from the host: ${r.owner_message}` : "",
      "", `Details: ${link}`]
    : [`Ciao ${r.name},`, "",
      ok ? `il tuo soggiorno a ${s.nome} è confermato: ${roomName(s, r.room_id, "it")}, dal ${fmtDate(r.check_in)} al ${fmtDate(r.check_out)}.` : `purtroppo non possiamo accettare la richiesta dal ${fmtDate(r.check_in)} al ${fmtDate(r.check_out)}.`,
      ok ? `Check-in dalle ${reg.checkInDalle || "15:00"} (ci hai indicato verso le ${r.arrival}), check-out entro le ${reg.checkOutEntro || "10:30"}.` : "",
      r.owner_message ? `\nMessaggio della struttura: ${r.owner_message}` : "",
      "", `Dettagli: ${link}`];
  return {
    subject: en ? `${s.nome}: ${ok ? "booking confirmed" : "about your request"}` : `${s.nome}: ${ok ? "prenotazione confermata" : "la tua richiesta"}`,
    text: lines.filter((x) => x !== "").join("\n") + `\n\n${s.nome} · ${s.contatti?.telefono || ""} · ${s.contatti?.email || ""}`,
  };
}
