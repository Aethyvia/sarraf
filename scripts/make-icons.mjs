// Draws Sarraf's app icons: the Welcome screen's green tile with the white "$" (Lucide dollar-sign, 24-grid).
// Run: node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const GREEN = [0x1f, 0x5a, 0x52];
const WHITE = [0xff, 0xff, 0xff];

// The "$" as line segments on the 24-grid: the stem, and the S (two semicircles joined by straight runs).
function dollarSegments() {
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n = 48) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  pts.push([17, 5], [9.5, 5]);
  arc(9.5, 8.5, 3.5, -Math.PI / 2, -Math.PI * 1.5); // left half, top to bottom
  pts.push([14.5, 12]);
  arc(14.5, 15.5, 3.5, -Math.PI / 2, Math.PI / 2); // right half, top to bottom
  pts.push([6, 19]);
  const segs = [[[12, 2], [12, 22]]];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  return segs;
}

function distToSeg(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.hypot(x, y);
}

/**
 * size: canvas px; glyph: how many px the 24-grid covers; bg: colour or null (transparent);
 * radius: corner radius of the background tile (0 = full square); stroke: on the 24-grid.
 */
function draw({ size, glyph, bg, radius = 0, fg = WHITE, stroke = 2 }) {
  const png = new PNG({ width: size, height: size });
  const segs = dollarSegments();
  const scale = glyph / 24, off = (size - glyph) / 2;
  const half = (stroke / 2) * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Background tile coverage (rounded square), antialiased.
      let bgA = 0;
      if (bg) {
        const r = radius;
        const cx = Math.min(Math.max(x + 0.5, r), size - r), cy = Math.min(Math.max(y + 0.5, r), size - r);
        const d = r ? Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r : -1;
        bgA = Math.max(0, Math.min(1, 0.5 - d));
      }
      // Glyph coverage.
      const gx = (x + 0.5 - off) / scale, gy = (y + 0.5 - off) / scale;
      let d = Infinity;
      for (const s of segs) d = Math.min(d, distToSeg(gx, gy, s));
      const fgA = Math.max(0, Math.min(1, half - d * scale + 0.5));
      const a = fgA + bgA * (1 - fgA);
      const mix = (k) => (a ? Math.round((fg[k] * fgA + (bg ? bg[k] : 0) * bgA * (1 - fgA)) / a) : 0);
      png.data[i] = mix(0);
      png.data[i + 1] = mix(1);
      png.data[i + 2] = mix(2);
      png.data[i + 3] = Math.round(a * 255);
    }
  }
  return PNG.sync.write(png);
}

const out = (name, buf) => writeFileSync(new URL(`../assets/${name}`, import.meta.url), buf);
// Store / launcher icon: full green square (Android masks it), glyph about half the width.
out('icon.png', draw({ size: 1024, glyph: 560, bg: GREEN }));
// Adaptive icon: green background, white "$" inside the 66% safe zone.
out('android-icon-background.png', draw({ size: 512, glyph: 0.001, bg: GREEN, fg: GREEN }));
out('android-icon-foreground.png', draw({ size: 512, glyph: 220, bg: null }));
out('android-icon-monochrome.png', draw({ size: 432, glyph: 186, bg: null }));
// Splash: the rounded green tile, as on the Welcome screen.
out('splash-icon.png', draw({ size: 1024, glyph: 520, bg: GREEN, radius: 230 }));
out('favicon.png', draw({ size: 48, glyph: 28, bg: GREEN, radius: 11 }));
console.log('icons written');
