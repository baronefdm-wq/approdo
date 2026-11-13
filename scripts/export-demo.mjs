// Crea una versione dimostrativa statica del sito (per GitHub Pages): npm run demo
// Il calendario funziona con date occupate d'esempio; l'invio mostra un avviso e non manda nulla.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, loadStruttura } from "../src/config.mjs";
import { openDb } from "../src/db.mjs";
import { addDays, timeSlots, todayRome } from "../src/dates.mjs";
import { sitePage } from "../src/views/site.mjs";

const out = path.resolve(process.argv[2] || path.join(ROOT, "demo-site"));
mkdirSync(out, { recursive: true });
const s = loadStruttura();
const db = openDb(":memory:", s, { demo: true });
const today = todayRome();
const st = db.settings();

const relative = (html, lang) => html
  .replace(/href="\/style\.css"/g, 'href="style.css"')
  .replace(/src="\/prenota\.js"/g, 'src="prenota.js"')
  .replace(/src="\/foto\//g, 'src="foto/')
  .replace(/href="\/\?lang=en"/g, 'href="en.html"')
  .replace(/href="\/\?lang=it"/g, 'href="index.html"')
  .replace("<head>", `<head>\n<meta name="robots" content="noindex">`);

writeFileSync(path.join(out, "index.html"), relative(sitePage(s, db, "it", { staticDemo: true }), "it"));
writeFileSync(path.join(out, "en.html"), relative(sitePage(s, db, "en", { staticDemo: true }), "en"));
writeFileSync(path.join(out, "disponibilita.json"), JSON.stringify({
  today, maxDate: addDays(today, st.maxAdvanceDays),
  settings: { checkInFrom: st.checkInFrom, checkInTo: st.checkInTo, checkOutBy: st.checkOutBy, minNights: st.minNights, discount: st.discount, slots: timeSlots(st.checkInFrom, st.checkInTo) },
  rooms: s.camere.map((c) => ({ id: c.id, name: c.nome, max: c.ospitiMax, price: c.prezzoBase, busy: db.busy(c.id, today).map((b) => [b.check_in, b.check_out]) })),
}));
for (const f of ["style.css", "prenota.js"]) copyFileSync(path.join(ROOT, "public", f), path.join(out, f));
const foto = path.join(ROOT, "public", "foto");
if (existsSync(foto)) {
  mkdirSync(path.join(out, "foto"), { recursive: true });
  for (const f of readdirSync(foto)) copyFileSync(path.join(foto, f), path.join(out, "foto", f));
}
writeFileSync(path.join(out, ".nojekyll"), "");
db.close();
console.log(`Demo statica creata in ${out}`);
