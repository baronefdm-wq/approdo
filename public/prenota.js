// Calendario di prenotazione: legge le disponibilità dal server e invia la richiesta.
(function () {
  "use strict";
  var root = document.getElementById("booking");
  if (!root) return;
  var lang = root.dataset.lang === "en" ? "en" : "it";
  var L = function (it, en) { return lang === "en" ? en : it; };
  var $ = function (id) { return document.getElementById(id); };
  var A = null, room = null, start = null, end = null, offset = 0;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nights(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
  function fmt(s) { return new Date(s + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { timeZone: "UTC", day: "numeric", month: "short" }); }
  function eur(n) { return new Intl.NumberFormat(lang === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n); }
  function cur() { return A.rooms.find(function (r) { return r.id === room; }); }
  function busyNight(d) { return cur().busy.some(function (b) { return b[0] <= d && d < b[1]; }); }
  function free(a, b) { return !cur().busy.some(function (x) { return a < x[1] && x[0] < b; }); }
  function err(m) { var e = $("req-err"); e.textContent = m || ""; e.hidden = !m; }

  function renderRooms() {
    var box = $("ap-rooms");
    box.innerHTML = "";
    A.rooms.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ap-room"; b.setAttribute("aria-pressed", String(r.id === room));
      var n = document.createElement("b"); n.textContent = r.name[lang] || r.name.it;
      var c = document.createElement("span"); c.className = "muted small"; c.textContent = L("fino a ", "up to ") + r.max + L(" ospiti", " guests");
      var p = document.createElement("span"); p.className = "num"; p.textContent = eur(r.price) + L(" / notte", " / night");
      b.append(n, c, p);
      b.onclick = function () { room = r.id; start = end = null; err(); render(); };
      box.appendChild(b);
    });
  }

  function renderMonths() {
    var base = new Date(A.today + "T12:00:00Z"); base.setUTCDate(1); base.setUTCMonth(base.getUTCMonth() + offset);
    var dows = lang === "en" ? ["M", "T", "W", "T", "F", "S", "S"] : ["L", "M", "M", "G", "V", "S", "D"];
    var box = $("ap-months"); box.innerHTML = "";
    for (var m = 0; m < 2; m++) {
      var d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, 1, 12));
      var y = d.getUTCFullYear(), mo = d.getUTCMonth(), first = (d.getUTCDay() + 6) % 7, len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      var wrap = document.createElement("div"); wrap.className = "ap-month";
      var h = document.createElement("h4"); h.textContent = d.toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { timeZone: "UTC", month: "long", year: "numeric" });
      var dow = document.createElement("div"); dow.className = "ap-dow";
      dows.forEach(function (x) { var s = document.createElement("span"); s.textContent = x; dow.appendChild(s); });
      var days = document.createElement("div"); days.className = "ap-days";
      for (var i = 0; i < first; i++) { var e = document.createElement("span"); e.className = "ap-day empty"; days.appendChild(e); }
      for (var day = 1; day <= len; day++) {
        var s = y + "-" + pad(mo + 1) + "-" + pad(day);
        var b = document.createElement("button"); b.type = "button"; b.className = "ap-day"; b.textContent = day; b.dataset.d = s;
        b.setAttribute("aria-label", new Date(s + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { timeZone: "UTC", day: "numeric", month: "long" }));
        if (s < A.today || s > A.maxDate) b.disabled = true;
        else if (busyNight(s) && s !== end) b.classList.add("busy");
        if (s === start || s === end) b.classList.add("sel");
        else if (start && end && s > start && s < end) b.classList.add("range");
        b.onclick = function () { pick(this.dataset.d); };
        days.appendChild(b);
      }
      wrap.append(h, dow, days); box.appendChild(wrap);
    }
    $("ap-prev").disabled = offset <= 0;
    $("ap-next").disabled = offset >= 11;
  }

  function pick(s) {
    err(); $("req-ok").hidden = true;
    if (!start || end || s <= start) {
      if (busyNight(s)) { err(L("Quella notte è già occupata: scegli un altro giorno di arrivo.", "That night is taken: pick another check-in day.")); return; }
      start = s; end = null;
    } else if (!free(start, s)) { err(L("Nel periodo scelto c'è almeno una notte occupata.", "At least one night in that range is taken.")); start = null; }
    else end = s;
    render();
  }

  function renderForm() {
    var r = cur(), st = A.settings;
    var a = $("f-arrival"), av = a.value; a.innerHTML = "";
    st.slots.forEach(function (t) { var o = document.createElement("option"); o.textContent = t; a.appendChild(o); });
    if (av && st.slots.indexOf(av) >= 0) a.value = av;
    var g = $("f-guests"), gv = Number(g.value || 2); g.innerHTML = "";
    for (var i = 1; i <= r.max; i++) { var o = document.createElement("option"); o.textContent = i; g.appendChild(o); }
    g.value = String(Math.min(gv, r.max));
    $("rules-line").textContent = L("Check-in dalle " + st.checkInFrom + " alle " + st.checkInTo + " · check-out entro le " + st.checkOutBy + " · minimo " + st.minNights + " notti.",
      "Check-in " + st.checkInFrom + "–" + st.checkInTo + " · check-out by " + st.checkOutBy + " · minimum " + st.minNights + " nights.");
    $("sum-room").textContent = r.name[lang] || r.name.it;
    if (start && end) {
      var n = nights(start, end), full = n * r.price, tot = Math.round(full * (1 - st.discount / 100));
      $("sum-dates").textContent = fmt(start) + " → " + fmt(end);
      $("sum-nights").textContent = n;
      if ($("sum-full")) $("sum-full").textContent = eur(full);
      $("sum-total").textContent = eur(tot);
    } else {
      $("sum-dates").textContent = start ? L("scegli la partenza", "pick check-out") : L("scegli l'arrivo", "pick check-in");
      ["sum-nights", "sum-full", "sum-total"].forEach(function (k) { if ($(k)) $(k).textContent = "—"; });
    }
  }

  function render() { renderRooms(); renderMonths(); renderForm(); }

  $("ap-prev").onclick = function () { if (offset > 0) { offset--; renderMonths(); } };
  $("ap-next").onclick = function () { if (offset < 11) { offset++; renderMonths(); } };

  $("ap-form").addEventListener("submit", function (e) {
    e.preventDefault(); err(); $("req-ok").hidden = true;
    if (!start || !end) { err(L("Scegli sul calendario il giorno di arrivo e quello di partenza.", "Pick your check-in and check-out days on the calendar.")); return; }
    if (nights(start, end) < A.settings.minNights) { err(L("Il soggiorno minimo è di " + A.settings.minNights + " notti.", "The minimum stay is " + A.settings.minNights + " nights.")); return; }
    var f = e.target, btn = $("req-send");
    var v = function (n) { var el = f.elements.namedItem(n); return el ? el.value : ""; };
    var body = { lang: lang, roomId: room, checkIn: start, checkOut: end, arrival: v("arrival"), guests: Number(v("guests")), name: v("name"), email: v("email"), phone: v("phone"), note: v("note"), website: v("website") };
    if (root.dataset.demo) {
      var box = $("req-ok"); box.innerHTML = "";
      var p0 = document.createElement("p");
      p0.textContent = L("Questa è una demo: la richiesta non è stata inviata. Sul sito vero arriverebbe subito al gestore via email, e tu riceveresti un riepilogo.",
        "This is a demo: the request was not sent. On the real site it would reach the owner by email right away, and you would get a summary.");
      box.appendChild(p0); box.hidden = false; return;
    }
    btn.disabled = true;
    fetch("/api/richieste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        if (!x.j.ok) { err((x.j.errors || [L("Invio non riuscito.", "Sending failed.")]).join(" ")); load(); return; }
        var ok = $("req-ok"); ok.innerHTML = "";
        var p1 = document.createElement("p"); p1.textContent = L("Richiesta inviata! Ti abbiamo scritto un'email di riepilogo: ti confermiamo entro 24 ore.", "Request sent! We emailed you a summary and will confirm within 24 hours.");
        ok.appendChild(p1);
        if (x.j.link) { var a = document.createElement("a"); a.href = x.j.link; a.textContent = L("Segui lo stato della richiesta", "Track your request"); ok.appendChild(a); }
        ok.hidden = false; start = end = null; $("f-note").value = ""; load();
      })
      .catch(function () { err(L("Connessione non riuscita. Riprova.", "Connection failed. Please try again.")); })
      .then(function () { btn.disabled = false; });
  });

  function load() {
    fetch(root.dataset.api || "/api/disponibilita").then(function (r) { return r.json(); }).then(function (a) {
      A = a;
      if (root.dataset.demo) { var t = new Date(); A.today = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); if (A.maxDate < A.today) A.maxDate = A.today.slice(0, 4) * 1 + 1 + A.today.slice(4); }
      if (!room || !A.rooms.some(function (r) { return r.id === room; })) room = A.rooms[0].id; render();
    }).catch(function () { err(L("Non riesco a caricare le disponibilità. Ricarica la pagina.", "Couldn't load availability. Please reload.")); });
  }
  load();

  // Calcolatore del risparmio (solo nella demo)
  var calc = document.getElementById("calc");
  if (calc) {
    var upd = function () {
      var n = +$("c-nights").value, pr = +$("c-price").value, fee = +$("c-fee").value / 100, sh = +$("c-share").value / 100;
      $("o-nights").textContent = n; $("o-price").textContent = eur(pr); $("o-fee").textContent = Math.round(fee * 100) + "%"; $("o-share").textContent = Math.round(sh * 100) + "%";
      var fees = n * pr * fee;
      $("r-fees").textContent = eur(fees);
      $("r-save").textContent = eur(fees * sh) + L(" / anno", " / year");
    };
    ["c-nights", "c-price", "c-fee", "c-share"].forEach(function (k) { $(k).addEventListener("input", upd); });
    upd();
  }

  // Mare animato se non c'è una foto principale
  var c = document.getElementById("sea");
  if (c && c.getContext) {
    var ctx = c.getContext("2d"), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var size = function () { var r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); c.width = r.width * dpr; c.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    var draw = function (t) {
      var w = c.clientWidth, h = c.clientHeight; ctx.clearRect(0, 0, w, h);
      var sky = ctx.createLinearGradient(0, 0, 0, h * .45); sky.addColorStop(0, "#9fd6de"); sky.addColorStop(1, "#e8f5f3"); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * .45);
      ctx.fillStyle = "#f2b632"; ctx.beginPath(); ctx.arc(w * .78, h * .2, Math.min(w, h) * .08, 0, Math.PI * 2); ctx.fill();
      for (var k = 0; k < 4; k++) { var y0 = h * (.42 + k * .045); ctx.fillStyle = ["#2f8e9c", "#1f7685", "#14606e", "#0f5c6e"][k]; ctx.beginPath(); ctx.moveTo(0, h * .62);
        for (var x = 0; x <= w; x += 8) ctx.lineTo(x, y0 + Math.sin(x / (38 + k * 10) + t / (1400 - k * 200) + k) * (3 + k)); ctx.lineTo(w, h * .62); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#f0dcb3"; ctx.beginPath(); ctx.moveTo(0, h * .6); for (var x2 = 0; x2 <= w; x2 += 10) ctx.lineTo(x2, h * .6 + Math.sin(x2 / 60 + t / 2000) * 2.5); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      var cols = [["#0f5c6e", "#e7f3f2"], ["#e2603f", "#fbfaf6"], ["#0f5c6e", "#e7f3f2"], ["#f2b632", "#fbfaf6"]];
      for (var u = 0; u < 4; u++) { var ux = w * (.16 + u * .22), uy = h * (.7 + (u % 2) * .07), rr = Math.min(w, h) * .085;
        ctx.strokeStyle = "#5a4a3a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux, uy + rr * 1.3); ctx.stroke();
        for (var sg = 0; sg < 6; sg++) { ctx.fillStyle = cols[u][sg % 2]; ctx.beginPath(); ctx.moveTo(ux, uy); ctx.arc(ux, uy, rr, Math.PI + sg * Math.PI / 6, Math.PI + (sg + 1) * Math.PI / 6); ctx.closePath(); ctx.fill(); } }
      if (!reduce) requestAnimationFrame(draw);
    };
    size(); addEventListener("resize", size); requestAnimationFrame(draw);
  }
})();
