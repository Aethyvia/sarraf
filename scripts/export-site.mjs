// Builds the public site (Terms, Privacy and a small home page) for GitHub Pages from
// src/legal/legal.json, the same text the app shows. Run: node scripts/export-site.mjs
// Output: site/ — copy its contents into the public GitHub repo (see site/README.md).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('site/', root);
mkdirSync(out, { recursive: true });
const legal = JSON.parse(readFileSync(new URL('src/legal/legal.json', root)));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Plain text with bare email addresses and URLs made into links.
const linkify = (s) =>
  esc(s)
    .replace(/\b([\w.+-]+@[\w-]+\.[\w.]+[\w])\b/g, '<a href="mailto:$1">$1</a>')
    .replace(/\b(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1">$1</a>');

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="favicon.png">
<style>
:root { --bg: #FAF7F2; --ink: #1E2421; --muted: #5F655F; --brand: #1F5A52; --line: #E6E0D5; }
@media (prefers-color-scheme: dark) { :root { --bg: #151917; --ink: #ECEAE4; --muted: #A2A69F; --brand: #8FC9BC; --line: #2E3532; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 40px 20px 64px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
header img { width: 44px; height: 44px; border-radius: 10px; }
header a { color: var(--ink); text-decoration: none; font-weight: 700; font-size: 20px; }
h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
h2 { font-size: 19px; margin: 30px 0 6px; }
.updated { color: var(--muted); margin: 0 0 22px; }
a { color: var(--brand); }
footer { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 16px; color: var(--muted); font-size: 14px; display: flex; gap: 16px; flex-wrap: wrap; }
</style>
</head>
<body>
<main>
<header><img src="icon.png" alt=""><a href="./">Sarraf</a></header>
${body}
<footer><a href="privacy.html">Privacy Policy</a><a href="terms.html">Terms of Use</a><span>Made by Aethyvia</span></footer>
</main>
</body>
</html>
`;

for (const key of ['privacy', 'terms']) {
  const d = legal[key];
  const sections = d.sections.map((s) => `<h2>${esc(s.heading)}</h2>\n${s.paragraphs.map((p) => `<p>${linkify(p)}</p>`).join('\n')}`).join('\n');
  const body = `<h1>${esc(d.title)}</h1>\n<p class="updated">Last updated: ${esc(legal.updated)}</p>\n<p>${linkify(d.intro)}</p>\n${sections}`;
  writeFileSync(new URL(`${key}.html`, out), page(`Sarraf — ${d.title}`, body));
}

writeFileSync(
  new URL('index.html', out),
  page(
    'Sarraf',
    `<h1>Every currency you earn and spend, in one place.</h1>
<p>Sarraf is a money ledger for people who earn, hold and spend in several currencies. See what each transfer really turned into, at the rate you actually got.</p>
<p>Your money data stays on your phone. Backups are encrypted on your phone and go to your own Google Drive.</p>`,
  ),
);

copyFileSync(new URL('assets/store-icon-512.png', root), new URL('icon.png', out));
copyFileSync(new URL('assets/favicon.png', root), new URL('favicon.png', out));
console.log('site/ written');
