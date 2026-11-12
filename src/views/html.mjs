/** Template HTML con escape automatico dei valori. Usa raw() per HTML già sicuro. */
const RAW = Symbol("raw");

export function raw(s) { return { [RAW]: true, value: String(s) }; }

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function render(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && v[RAW]) return v.value;
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return raw(out);
}

export function page({ title, lang = "it", body, noindex = false, head = "" }) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/style.css">
${head}
</head>
<body>
${render(body)}
</body>
</html>`;
}
