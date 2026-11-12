import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Legge la configurazione della struttura (config/struttura.json o STRUTTURA_PATH). */
export function loadStruttura() {
  const file = process.env.STRUTTURA_PATH || path.join(ROOT, "config", "struttura.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  if (!s.nome || !Array.isArray(s.camere) || !s.camere.length) {
    throw new Error("config/struttura.json: servono almeno 'nome' e una camera in 'camere'.");
  }
  const ids = new Set();
  for (const c of s.camere) {
    if (!/^[a-z0-9-]{1,40}$/.test(c.id || "")) throw new Error(`Camera con id non valido: "${c.id}". Usa lettere minuscole, numeri e trattini.`);
    if (ids.has(c.id)) throw new Error(`Id camera ripetuto: ${c.id}`);
    ids.add(c.id);
    if (!(c.ospitiMax >= 1) || !(c.prezzoBase > 0)) throw new Error(`Camera ${c.id}: servono ospitiMax e prezzoBase.`);
  }
  return s;
}

export const env = {
  get port() { return Number(process.env.PORT || 3000); },
  get dataMode() { return process.env.DATA_MODE === "live" ? "live" : "demo"; },
  get siteUrl() { return (process.env.SITE_URL || `http://localhost:${this.port}`).replace(/\/$/, ""); },
  get adminPassword() { return process.env.ADMIN_PASSWORD || ""; },
  get sessionSecret() { return process.env.SESSION_SECRET || ""; },
  get feedKey() { return process.env.ICAL_FEED_KEY || ""; },
  get notifyTo() { return (process.env.NOTIFY_EMAIL_TO || "").split(",").map((x) => x.trim()).filter(Boolean); },
  get smtp() {
    return {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
    };
  },
  get syncMinutes() { return Math.max(10, Number(process.env.ICAL_SYNC_MINUTES || 30)); },
  get dbPath() {
    if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
    return path.join(ROOT, "data", this.dataMode === "live" ? "approdo.db" : "approdo-demo.db");
  },
};

/** Controlli all'avvio: in modalità live mancano dati essenziali → errore chiaro. */
export function checkEnv() {
  const problems = [];
  if (env.adminPassword.length < 12) problems.push("ADMIN_PASSWORD deve avere almeno 12 caratteri.");
  if (env.sessionSecret.length < 32) problems.push("SESSION_SECRET deve avere almeno 32 caratteri.");
  if (env.dataMode === "live") {
    if (!env.smtp.host || !env.notifyTo.length) problems.push("In modalità live servono SMTP_HOST e NOTIFY_EMAIL_TO per avvisare il gestore.");
    if (env.feedKey.length < 16) problems.push("In modalità live serve ICAL_FEED_KEY (almeno 16 caratteri).");
  }
  return problems;
}
