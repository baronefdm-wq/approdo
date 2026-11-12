import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { env } from "./config.mjs";

const COOKIE = "approdo_gestore";
const HOURS = 12;

function sign(value) {
  return createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// La password del gestore viene confrontata tramite scrypt, a tempo costante.
const salt = randomBytes(16);
let expected = null;
export function checkPassword(input) {
  if (!env.adminPassword) return false;
  if (!expected) expected = scryptSync(env.adminPassword, salt, 32);
  const got = scryptSync(String(input || ""), salt, 32);
  return timingSafeEqual(got, expected);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(req) {
  const nonce = randomBytes(12).toString("base64url");
  const exp = Date.now() + HOURS * 3600e3;
  const v = `${exp}.${nonce}`;
  const secure = isHttps(req) ? "; Secure" : "";
  return `${COOKIE}=${v}.${sign(v)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${HOURS * 3600}${secure}`;
}
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Restituisce l'identificativo di sessione se il cookie è valido e non scaduto. */
export function session(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  const v = raw.slice(0, i), sig = raw.slice(i + 1);
  if (!v || !safeEq(sig, sign(v))) return null;
  if (Number(v.split(".")[0]) < Date.now()) return null;
  return v;
}

export function csrfToken(sid) { return sign(`csrf:${sid}`); }
export function checkCsrf(sid, token) { return !!sid && safeEq(token || "", csrfToken(sid)); }

export function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted === true;
}

/** Limite semplice per IP (in memoria): accessi, invii di richieste. */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return true;
  };
}
