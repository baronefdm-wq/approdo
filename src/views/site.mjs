import { html, page, raw } from "./html.mjs";
import { fmtDate } from "../dates.mjs";
import { env } from "../config.mjs";

const T = {
  it: {
    book: "Prenota", check: "Verifica disponibilità", rooms: "Le camere", roomsTitle: "Scegli la tua camera",
    perNight: "a notte, da", upTo: "fino a", guests: "ospiti", where: "Dove siamo", whereTitle: "Tutto a piedi, Roma in treno",
    bookEyebrow: "Prenotazione diretta", bookTitle: "Scegli camera e date, confermiamo entro 24 ore",
    strip1: "prenotando qui invece che sui portali", strip2: "di commissioni, paghi direttamente a noi", strip3: "per confermare ogni richiesta",
    availability: "Disponibilità", free: "Libera", taken: "Occupata", sel: "Arrivo / partenza",
    yourReq: "La tua richiesta", nights: "Notti", portal: "Prezzo sui portali", direct: "Prezzo diretto",
    arrival: "Orario di arrivo", guestsL: "Ospiti", name: "Nome e cognome", email: "Email", phone: "Telefono (facoltativo)", note: "Note (facoltative)",
    send: "Invia richiesta di prenotazione", payNote: "Non paghi nulla ora: la struttura conferma la disponibilità e ti scrive per la caparra.",
    privacy: "Usiamo i tuoi dati solo per rispondere a questa richiesta.", noJs: "Per prenotare attiva JavaScript, oppure scrivici:",
    contacts: "Contatti",
  },
  en: {
    book: "Book", check: "Check availability", rooms: "Rooms", roomsTitle: "Choose your room",
    perNight: "per night, from", upTo: "up to", guests: "guests", where: "Location", whereTitle: "Everything on foot, Rome by train",
    bookEyebrow: "Book direct", bookTitle: "Pick a room and dates, we confirm within 24 hours",
    strip1: "when you book here instead of on booking sites", strip2: "in fees, you pay us directly", strip3: "to confirm every request",
    availability: "Availability", free: "Free", taken: "Taken", sel: "Check-in / check-out",
    yourReq: "Your request", nights: "Nights", portal: "Price on booking sites", direct: "Direct price",
    arrival: "Arrival time", guestsL: "Guests", name: "Full name", email: "Email", phone: "Phone (optional)", note: "Notes (optional)",
    send: "Send booking request", payNote: "Nothing to pay now: the property confirms availability and emails you about the deposit.",
    privacy: "We only use your details to answer this request.", noJs: "To book please enable JavaScript, or contact us:",
    contacts: "Contacts",
  },
};

function photo(file, colore, label) {
  if (file) return html`<img src="/foto/${file}" alt="${label}" loading="lazy">`;
  return html`<div class="ph-fill" style="background:${colore || "var(--foam)"}"></div>`;
}

export function sitePage(s, db, lang, { staticDemo = false } = {}) {
  const t = T[lang];
  const L = (o) => (o && (o[lang] || o.it)) || "";
  const st = db.settings();
  const prices = Object.fromEntries(db.rooms().map((r) => [r.id, r.price]));
  const other = lang === "it" ? "en" : "it";
  const demo = staticDemo || env.dataMode === "demo";
  const body = html`
${demo ? html`<div class="demo"><div class="wrap">${lang === "it" ? "Versione dimostrativa: le prenotazioni non sono reali." : "Demo version: bookings are not real."}</div></div>` : ""}
<div class="awning" aria-hidden="true"></div>
<header class="top"><div class="wrap">
  <div class="brand">${s.nome}<small>${L(s.tipo)}</small></div>
  <nav class="top-actions">
    <a class="lang-link" href="/?lang=${other}" hreflang="${other}">${other.toUpperCase()}</a>
    <a class="btn btn-primary" href="#prenota">${t.book}</a>
  </nav>
</div></header>

<div class="hero"><div class="wrap">
  <div>
    <h1>${L(s.titolo)}</h1>
    <p class="lead">${L(s.descrizione)}</p>
    <div class="cta"><a class="btn btn-primary" href="#prenota">${t.check}</a><a class="btn btn-ghost" href="#camere">${t.rooms}</a></div>
    <div class="facts">${(s.servizi?.[lang] || []).map((x) => html`<span class="chip">${x}</span>`)}</div>
  </div>
  <div class="scene">${s.fotoPrincipale ? html`<img src="/foto/${s.fotoPrincipale}" alt="${s.nome}">` : html`<canvas id="sea" aria-hidden="true"></canvas>`}</div>
</div></div>

<div class="strip"><div class="wrap">
  ${st.discount > 0 ? html`<div><b>−${st.discount}%</b><span>${t.strip1}</span></div>` : ""}
  <div><b>0 €</b><span>${t.strip2}</span></div>
  <div><b>24 h</b><span>${t.strip3}</span></div>
</div></div>

<section id="camere"><div class="wrap">
  <div class="sec-head"><p class="eyebrow">${t.rooms}</p><h2>${t.roomsTitle}</h2></div>
  <div class="rooms">${s.camere.map((c) => html`
    <article class="room">
      <div class="ph">${photo(c.foto, c.colore, L(c.nome))}</div>
      <div class="body"><h3>${L(c.nome)}</h3><p class="muted">${L(c.descrizione)}</p>
        <ul>${(c.dettagli?.[lang] || []).map((d) => html`<li>${d}</li>`)}</ul>
        <div class="price"><small>${t.perNight}</small><b class="num">${prices[c.id] ?? c.prezzoBase} €</b></div>
      </div>
    </article>`)}</div>
</div></section>

${s.distanze?.length ? html`<section class="sand"><div class="wrap">
  <div class="sec-head"><p class="eyebrow">${t.where}</p><h2>${t.whereTitle}</h2></div>
  <ul class="dist">${s.distanze.map((d) => html`<li><span>${L(d.luogo)}</span><span class="num">${L(d.tempo)}</span></li>`)}</ul>
</div></section>` : ""}

<section id="prenota"><div class="wrap">
  <div class="sec-head"><p class="eyebrow">${t.bookEyebrow}</p><h2>${t.bookTitle}</h2></div>
  <noscript><p class="notice">${t.noJs} ${s.contatti?.email} · ${s.contatti?.telefono}</p></noscript>
  <div class="ap-book" id="booking" data-lang="${lang}" data-demo="${staticDemo ? "1" : ""}" data-api="${staticDemo ? "disponibilita.json" : "/api/disponibilita"}">
    <div class="panel">
      <div class="ap-head"><h3>${t.availability}</h3>
        <div class="row-gap"><button class="btn-sm ghost" type="button" id="ap-prev" aria-label="‹">‹</button><button class="btn-sm ghost" type="button" id="ap-next" aria-label="›">›</button></div>
      </div>
      <div class="ap-rooms" id="ap-rooms"></div>
      <div class="ap-months" id="ap-months"></div>
      <div class="legend">
        <span><i class="lg-free"></i>${t.free}</span><span><i class="lg-busy"></i>${t.taken}</span><span><i class="lg-sel"></i>${t.sel}</span>
      </div>
    </div>
    <form class="panel" id="ap-form" novalidate>
      <h3>${t.yourReq}</h3>
      <div class="summary">
        <div class="srow"><span id="sum-room">—</span><span class="num" id="sum-dates">—</span></div>
        <div class="srow"><span class="muted">${t.nights}</span><span class="num" id="sum-nights">—</span></div>
        ${st.discount > 0 ? html`<div class="srow"><span class="muted">${t.portal}</span><span class="num strike" id="sum-full">—</span></div>` : ""}
        <div class="srow total"><span>${t.direct}</span><span class="num" id="sum-total">—</span></div>
      </div>
      <div class="grid2">
        <label for="f-arrival">${t.arrival}<select id="f-arrival" name="arrival"></select></label>
        <label for="f-guests">${t.guestsL}<select id="f-guests" name="guests"></select></label>
        <label class="full" for="f-name">${t.name}<input id="f-name" name="name" autocomplete="name" maxlength="80" required></label>
        <label for="f-email">${t.email}<input id="f-email" name="email" type="email" autocomplete="email" maxlength="120" required></label>
        <label for="f-phone">${t.phone}<input id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="30"></label>
        <label class="full" for="f-note">${t.note}<input id="f-note" name="note" maxlength="300"></label>
        <label class="hp" aria-hidden="true">Sito web<input name="website" tabindex="-1" autocomplete="off"></label>
      </div>
      <p class="muted small" id="rules-line"></p>
      <p class="err" id="req-err" hidden></p>
      <div class="okbox" id="req-ok" hidden></div>
      <button class="btn btn-primary" type="submit" id="req-send">${t.send}</button>
      <p class="muted small">${t.payNote} ${L(s.notaImposta)} ${t.privacy}</p>
    </form>
  </div>
</div></section>

<footer class="site"><div class="wrap">
  <span>${s.nome} · ${s.contatti?.indirizzo}</span>
  <span>${s.contatti?.email} · ${s.contatti?.telefono}</span>
  ${s.cin ? html`<span class="num">CIN ${s.cin}</span>` : ""}
</div></footer>
<script src="/prenota.js" defer></script>`;
  return page({ title: `${s.nome} · ${L(s.tipo)}`, lang, body, head: raw(`<meta name="description" content="${String(L(s.descrizione)).replace(/"/g, "&quot;")}">`) });
}

const STATUS = {
  it: { in_attesa: "In attesa di conferma", confermata: "Confermata", rifiutata: "Non accettata", annullata: "Annullata" },
  en: { in_attesa: "Waiting for confirmation", confermata: "Confirmed", rifiutata: "Not accepted", annullata: "Cancelled" },
};

export function requestPage(s, r) {
  const lang = r.lang === "en" ? "en" : "it";
  const room = s.camere.find((c) => c.id === r.room_id);
  const name = room?.nome?.[lang] || r.room_id;
  const en = lang === "en";
  const body = html`
<div class="awning" aria-hidden="true"></div>
<main class="wrap narrow">
  <p class="eyebrow">${s.nome}</p>
  <h1 class="h-page">${en ? "Your booking request" : "La tua richiesta di prenotazione"}</h1>
  <div class="panel">
    <p><span class="chip st-${r.status}">${STATUS[lang][r.status]}</span></p>
    <dl class="kv">
      <dt>${en ? "Room" : "Camera"}</dt><dd>${name}</dd>
      <dt>${en ? "Dates" : "Date"}</dt><dd>${fmtDate(r.check_in, lang)} → ${fmtDate(r.check_out, lang)} (${r.nights} ${en ? "nights" : "notti"})</dd>
      <dt>${en ? "Arrival" : "Arrivo"}</dt><dd>${r.arrival}</dd>
      <dt>${en ? "Guests" : "Ospiti"}</dt><dd>${r.guests}</dd>
      <dt>${en ? "Direct price" : "Prezzo diretto"}</dt><dd class="num">${r.total} €</dd>
    </dl>
    ${r.owner_message ? html`<p><b>${en ? "Message from the host:" : "Messaggio della struttura:"}</b> ${r.owner_message}</p>` : ""}
    ${r.status === "in_attesa" ? html`<form method="post" action="/richiesta/${r.token}/annulla"><button class="btn btn-ghost" type="submit">${en ? "Cancel this request" : "Annulla la richiesta"}</button></form>` : ""}
  </div>
  <p class="muted"><a href="/?lang=${lang}">← ${s.nome}</a> · ${s.contatti?.email} · ${s.contatti?.telefono}</p>
</main>`;
  return page({ title: `${s.nome} · ${en ? "Request" : "Richiesta"}`, lang, body, noindex: true });
}
