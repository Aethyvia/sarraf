// Writes docs/legal/privacy.md and terms.md from src/legal/legal.json (the same text the app shows).
// Run: node scripts/export-legal.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const legal = JSON.parse(readFileSync(new URL('../src/legal/legal.json', import.meta.url)));
for (const key of ['privacy', 'terms']) {
  const d = legal[key];
  const md = [`# Sarraf — ${d.title}`, '', `_Last updated: ${legal.updated}_`, '', d.intro, ''];
  for (const s of d.sections) md.push(`## ${s.heading}`, '', ...s.paragraphs.flatMap((p) => [p, '']));
  writeFileSync(new URL(`../docs/legal/${key}.md`, import.meta.url), md.join('\n'));
}
console.log('docs/legal written');
