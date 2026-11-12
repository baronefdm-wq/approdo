// Controlla config/struttura.json prima di pubblicare un nuovo cliente: npm run check
import { loadStruttura } from "../src/config.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/config.mjs";

try {
  const s = loadStruttura();
  const warn = [];
  const photos = [s.fotoPrincipale, ...s.camere.map((c) => c.foto)].filter(Boolean);
  for (const f of photos) if (!existsSync(path.join(ROOT, "public", "foto", f))) warn.push(`Foto mancante: public/foto/${f}`);
  for (const c of s.camere) for (const k of ["nome", "descrizione"]) if (!c[k]?.it || !c[k]?.en) warn.push(`Camera ${c.id}: manca ${k} in italiano o in inglese`);
  if (!s.cin || /X{4,}/.test(s.cin)) warn.push("CIN mancante o di esempio: è obbligatorio mostrarlo.");
  if (/esempio\.it|000 000/.test(JSON.stringify(s.contatti))) warn.push("Contatti ancora di esempio.");
  console.log(`✓ ${s.nome}: ${s.camere.length} camere.`);
  for (const w of warn) console.log(`! ${w}`);
  process.exit(0);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
