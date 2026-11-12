import { html, page } from "./html.mjs";
import { addDays, fmtDate, todayRome } from "../dates.mjs";
import { env } from "../config.mjs";

const SRC = { Sito: "src-sito", Booking: "src-booking", Airbnb: "src-airbnb", Manuale: "src-manuale", Esempio: "src-esempio" };
const STATUS = { in_attesa: "in attesa", confermata: "confermata", rifiutata: "rifiutata", annullata: "annullata" };
const d = (s) => fmtDate(s, "it", { day: "numeric", month: "short" });
const dt = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function shell(s, title, csrf, content, flash) {
  const body = html`
<div class="admin-bar"><div class="wrap">
  <b>Area gestore · ${s.nome}</b>
  <nav class="admin-nav">
    <a href="/gestione">Prenotazioni</a>
    <a href="/gestione/impostazioni">Impostazioni</a>
    <a href="/" target="_blank" rel="noopener">Vedi il sito</a>
    <form method="post" action="/gestione/esci"><input type="hidden" name="csrf" value="${csrf}"><button class="linkbtn" type="submit">Esci</button></form>
  </nav>
</div></div>
<main class="wrap admin-main">
  ${env.dataMode === "demo" ? html`<p class="notice">Modalità dimostrativa: le email partono solo se SMTP è configurato e i dati d'esempio sono segnati come "Esempio".</p>` : ""}
  ${flash ? html`<p class="flash ${flash.type}">${flash.text}</p>` : ""}
  ${content}
</main>`;
  return page({ title: `${title} · ${s.nome}`, body, noindex: true });
}

export function loginPage(s, error) {
  const body = html`
<div class="awning" aria-hidden="true"></div>
<main class="wrap narrow">
  <p class="eyebrow">${s.nome}</p>
  <h1 class="h-page">Area gestore</h1>
  <form class="panel" method="post" action="/gestione/accesso">
    <label for="pw">Password<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></label>
    ${error ? html`<p class="err">${error}</p>` : ""}
    <button class="btn btn-primary" type="submit">Entra</button>
  </form>
</main>`;
  return page({ title: `Accesso · ${s.nome}`, body, noindex: true });
}

export function dashboard(s, db, csrf, flash) {
  const today = todayRome();
  const roomName = (id) => s.camere.find((c) => c.id === id)?.nome?.it || id;
  const pending = db.pending();
  const stays = db.stays(today, addDays(today, 60));
  const days = Array.from({ length: 21 }, (_, i) => addDays(today, i));
  const in7 = stays.filter((x) => x.kind === "prenotazione" && x.check_in >= today && x.check_in <= addDays(today, 7));
  let occ = 0;
  for (const x of stays) for (let q = x.check_in; q < x.check_out; q = addDays(q, 1)) if (q >= today && q < addDays(today, 30)) occ++;
  const occPct = Math.round((occ / (s.camere.length * 30)) * 100);
  const reqById = (id) => (id ? db.request(id) : null);
  const recent = db.recentRequests(10);
  const notif = db.notifications(8);

  const content = html`
<div class="kpis">
  <div class="kpi ${pending.length ? "alert" : ""}"><span class="muted">Richieste da gestire</span><b class="num">${pending.length}</b></div>
  <div class="kpi"><span class="muted">Arrivi nei prossimi 7 giorni</span><b class="num">${in7.length}</b></div>
  <div class="kpi"><span class="muted">Occupazione prossimi 30 giorni</span><b class="num">${occPct}%</b></div>
</div>

<section class="panel">
  <h2>Richieste da gestire</h2>
  ${pending.length ? pending.map((r) => {
    const free = db.isFree(r.room_id, r.check_in, r.check_out);
    return html`<div class="item">
      <div class="what">
        <b>${r.name} · ${roomName(r.room_id)}</b>
        <span class="num">${d(r.check_in)} → ${d(r.check_out)} · ${r.nights} notti · ${r.guests} ospiti · arrivo ore ${r.arrival} · ${r.total} €</span>
        <span>${r.email}${r.phone ? ` · ${r.phone}` : ""}${r.lang === "en" ? " · scrive in inglese" : ""}</span>
        ${r.note ? html`<span class="muted">Note: ${r.note}</span>` : ""}
        <span class="muted small">Ricevuta ${dt(r.created_at)}</span>
        ${free ? "" : html`<span class="err">Le date non sono più libere: va rifiutata o va proposta un'alternativa.</span>`}
      </div>
      <form class="decide" method="post" action="/gestione/richieste/${r.id}">
        <input type="hidden" name="csrf" value="${csrf}">
        <label class="small" for="m-${r.id}">Messaggio per l'ospite (facoltativo)<input id="m-${r.id}" name="message" maxlength="400" placeholder="Es. per la caparra ti mandiamo l'IBAN a parte"></label>
        <div class="row-gap">
          <button class="btn-sm ok" name="azione" value="conferma" type="submit" ${free ? "" : "disabled"}>Conferma</button>
          <button class="btn-sm bad" name="azione" value="rifiuta" type="submit">Rifiuta</button>
        </div>
      </form>
    </div>`;
  }) : html`<p class="muted">Nessuna richiesta da gestire. Ogni nuova richiesta ti arriva anche via email.</p>`}
</section>

<section class="panel">
  <div class="ap-head"><h2>Planning</h2><span class="muted">prossimi 21 giorni</span></div>
  <div class="timeline"><div class="tl" style="grid-template-columns:minmax(120px,1.4fr) repeat(21,minmax(28px,1fr))">
    <div></div>
    ${days.map((q) => { const w = new Date(q + "T12:00:00Z").getUTCDay(); return html`<div class="h ${w === 0 || w === 6 ? "we" : ""}">${"DLMMGVS"[w]}<br>${Number(q.slice(8))}</div>`; })}
    ${s.camere.map((c) => html`<div class="rn">${c.nome.it}</div>${days.map((q) => {
      const x = stays.find((y) => y.room_id === c.id && y.check_in <= q && q < y.check_out);
      const wait = !x && pending.some((p) => p.room_id === c.id && p.check_in <= q && q < p.check_out);
      if (x) return html`<div class="c on ${SRC[x.source] || "src-manuale"}" title="${x.source}: ${d(x.check_in)} → ${d(x.check_out)}">${x.check_in === q || q === today ? (x.kind === "blocco" && x.source === "Manuale" ? "Blocco" : x.source) : ""}</div>`;
      return html`<div class="c ${wait ? "wait" : ""}" ${wait ? 'title="Richiesta in attesa"' : ""}></div>`;
    })}`)}
  </div></div>
  <div class="legend">${Object.entries(SRC).map(([k, v]) => html`<span><i class="${v}"></i>${k === "Manuale" ? "Blocco manuale" : k}</span>`)}<span><i class="lg-wait"></i>Richiesta in attesa</span></div>
</section>

<div class="cols">
  <section class="panel">
    <h2>Date occupate</h2>
    ${stays.length ? stays.map((x) => {
      const r = reqById(x.request_id);
      const canDel = x.source === "Sito" || x.source === "Manuale" || x.source === "Esempio";
      return html`<div class="item"><div class="what">
        <b>${roomName(x.room_id)} · ${d(x.check_in)} → ${d(x.check_out)}</b>
        <span class="muted">${r ? `${r.name} · arrivo ore ${r.arrival} · ${r.email}${r.phone ? " · " + r.phone : ""}` : x.label}</span>
      </div><div class="row-gap"><span class="src"><i class="${SRC[x.source]}"></i>${x.source}</span>
      ${canDel ? html`<form method="post" action="/gestione/date/${x.id}/elimina"><input type="hidden" name="csrf" value="${csrf}"><button class="btn-sm bad" type="submit">${x.source === "Sito" ? "Cancella prenotazione" : "Sblocca"}</button></form>` : ""}</div></div>`;
    }) : html`<p class="muted">Nessuna data occupata nei prossimi 60 giorni.</p>`}
  </section>

  <section class="panel">
    <h2>Blocca date</h2>
    <p class="muted">Per una prenotazione presa al telefono, una manutenzione o una chiusura.</p>
    <form method="post" action="/gestione/blocchi" class="grid2">
      <input type="hidden" name="csrf" value="${csrf}">
      <label for="b-room">Camera<select id="b-room" name="room">${s.camere.map((c) => html`<option value="${c.id}">${c.nome.it}</option>`)}</select></label>
      <label for="b-label">Motivo<input id="b-label" name="label" maxlength="60" placeholder="Es. prenotazione telefonica"></label>
      <label for="b-in">Dal<input id="b-in" name="from" type="date" min="${today}" required></label>
      <label for="b-out">Al (giorno di uscita)<input id="b-out" name="to" type="date" min="${addDays(today, 1)}" required></label>
      <div class="full"><button class="btn btn-sea" type="submit">Blocca</button></div>
    </form>
    <h2 style="margin-top:12px">Ultime decisioni</h2>
    ${recent.length ? recent.map((r) => html`<div class="item"><div class="what"><b>${r.name} · ${roomName(r.room_id)}</b><span class="muted num">${d(r.check_in)} → ${d(r.check_out)}</span></div><span class="chip st-${r.status}">${STATUS[r.status]}</span></div>`) : html`<p class="muted">Ancora nessuna.</p>`}
  </section>
</div>

<section class="panel">
  <h2>Email inviate</h2>
  ${notif.length ? notif.map((n) => html`<div class="item"><div class="what"><b>${n.subject}</b><span class="muted small">${dt(n.created_at)} · ${n.recipient}${n.error ? " · " + n.error : ""}</span></div><span class="chip ${n.status === "inviata" ? "st-confermata" : "st-rifiutata"}">${n.status}</span></div>`) : html`<p class="muted">Nessuna email ancora.</p>`}
</section>`;
  return shell(s, "Prenotazioni", csrf, content, flash);
}

export function settingsPage(s, db, csrf, flash) {
  const st = db.settings();
  const rooms = db.rooms();
  const feed = (id) => `${env.siteUrl}/ical/${id}.ics?k=${encodeURIComponent(env.feedKey)}`;
  const content = html`
<div class="cols">
  <form class="panel" method="post" action="/gestione/impostazioni">
    <input type="hidden" name="csrf" value="${csrf}">
    <h2>Orari e regole</h2>
    <div class="grid2">
      <label for="s-from">Check-in dalle<input id="s-from" name="checkInFrom" type="time" step="1800" value="${st.checkInFrom}" required></label>
      <label for="s-to">Check-in fino alle<input id="s-to" name="checkInTo" type="time" step="1800" value="${st.checkInTo}" required></label>
      <label for="s-out">Check-out entro le<input id="s-out" name="checkOutBy" type="time" step="1800" value="${st.checkOutBy}" required></label>
      <label for="s-min">Notti minime<input id="s-min" name="minNights" type="number" min="1" max="30" value="${st.minNights}" required></label>
      <label for="s-disc">Sconto prenotazione diretta (%)<input id="s-disc" name="discount" type="number" min="0" max="50" value="${st.discount}" required></label>
      <label for="s-adv">Prenotabile fino a (giorni da oggi)<input id="s-adv" name="maxAdvanceDays" type="number" min="30" max="730" value="${st.maxAdvanceDays}" required></label>
    </div>
    <button class="btn btn-sea" type="submit">Salva orari e regole</button>
  </form>
  <form class="panel" method="post" action="/gestione/prezzi">
    <input type="hidden" name="csrf" value="${csrf}">
    <h2>Prezzi a notte</h2>
    ${s.camere.map((c) => html`<label for="p-${c.id}">${c.nome.it} (fino a ${c.ospitiMax} ospiti)<input id="p-${c.id}" name="price_${c.id}" type="number" min="10" max="5000" value="${rooms.find((r) => r.id === c.id)?.price ?? c.prezzoBase}" required></label>`)}
    <button class="btn btn-sea" type="submit">Salva prezzi</button>
  </form>
</div>

<section class="panel">
  <h2>Collegamento con Booking e Airbnb</h2>
  <p class="muted">Incolla per ogni camera il link del calendario (.ics) che trovi su Booking (Tariffe e disponibilità → Sincronizza calendari) e su Airbnb (Calendario → Disponibilità → Collega calendari). Il sito li legge da solo ogni ${env.syncMinutes} minuti: quelle date non si possono prenotare qui. Poi copia il link "Calendario del sito" e caricalo su Booking e Airbnb, così bloccano le date vendute qui.</p>
  <form method="post" action="/gestione/calendari" class="cal-form">
    <input type="hidden" name="csrf" value="${csrf}">
    ${s.camere.map((c) => { const r = rooms.find((x) => x.id === c.id) || {}; return html`<fieldset class="cal-room">
      <legend>${c.nome.it}</legend>
      <label for="ib-${c.id}">Link calendario Booking<input id="ib-${c.id}" name="booking_${c.id}" type="url" placeholder="https://admin.booking.com/hotel/hoteladmin/ical.html?t=…" value="${r.ical_booking || ""}"></label>
      <label for="ia-${c.id}">Link calendario Airbnb<input id="ia-${c.id}" name="airbnb_${c.id}" type="url" placeholder="https://www.airbnb.it/calendar/ical/….ics?s=…" value="${r.ical_airbnb || ""}"></label>
      <label>Calendario del sito (da dare a Booking e Airbnb)<input type="text" readonly value="${env.feedKey ? feed(c.id) : "Imposta ICAL_FEED_KEY per attivarlo"}" onfocus="this.select()"></label>
      <p class="muted small">${r.last_sync ? `Ultima sincronizzazione ${dt(r.last_sync)}` : "Mai sincronizzato"}${r.last_sync_error ? ` · ${r.last_sync_error}` : ""}</p>
    </fieldset>`; })}
    <div class="row-gap"><button class="btn btn-sea" type="submit" name="azione" value="salva">Salva i link</button><button class="btn btn-ghost" type="submit" name="azione" value="sincronizza">Salva e sincronizza ora</button></div>
  </form>
</section>`;
  return shell(s, "Impostazioni", csrf, content, flash);
}
