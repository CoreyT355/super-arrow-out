#!/usr/bin/env node
/**
 * Generates static/icon-192.<VERSION>.png and static/icon-512.<VERSION>.png
 * using only built-in Node.js modules (no canvas / sharp needed).
 *
 * Run once after cloning:  node scripts/generate-icons.js
 *
 * ICON_VERSION is part of the filename so that changing the artwork forces a
 * brand-new URL — the only reliable way to bust home-screen / CDN icon caches.
 * When you change the icon, bump ICON_VERSION here and update the matching
 * filenames in static/manifest.webmanifest and src/app.html (apple-touch-icon),
 * then delete the previous static/icon-*.<oldVersion>.* files.
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ICON_VERSION = 'v2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../static');
mkdirSync(OUT, { recursive: true });

// ── PNG helpers ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf, seed = 0xffffffff) {
  let c = seed;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crcVal]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // colour type: RGB (we'll drop alpha by writing RGB rows)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Build raw filtered rows (filter byte 0 = None before each row)
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rows.push(rgba[i], rgba[i + 1], rgba[i + 2]); // R G B (drop A)
    }
  }

  const idat = deflateSync(Buffer.from(rows), { level: 6 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setPixel(buf, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  // Alpha-composite over existing colour
  const sa = a / 255, da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  buf[i]     = Math.round((r * sa + buf[i]     * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

function fillRect(buf, w, x0, y0, rw, rh, r, g, b, a = 255) {
  for (let y = y0; y < y0 + rh; y++)
    for (let x = x0; x < x0 + rw; x++)
      setPixel(buf, w, x, y, r, g, b, a);
}

// Filled circle (anti-aliased via coverage sampling)
function fillCircle(buf, w, cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx, dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) setPixel(buf, w, x, y, r, g, b, a);
    }
  }
}

// Rounded rectangle
function fillRoundRect(buf, w, x0, y0, rw, rh, radius, r, g, b, a = 255) {
  fillRect(buf, w, x0 + radius, y0,          rw - radius * 2, rh, r, g, b, a);
  fillRect(buf, w, x0,          y0 + radius, rw,              rh - radius * 2, r, g, b, a);
  fillCircle(buf, w, x0 + radius,       y0 + radius,       radius, r, g, b, a);
  fillCircle(buf, w, x0 + rw - radius,  y0 + radius,       radius, r, g, b, a);
  fillCircle(buf, w, x0 + radius,       y0 + rh - radius,  radius, r, g, b, a);
  fillCircle(buf, w, x0 + rw - radius,  y0 + rh - radius,  radius, r, g, b, a);
}

// Draw a thick line (Bresenham + width)
function fillLine(buf, w, x0, y0, x1, y1, thick, r, g, b, a = 255) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len) * 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t, py = y0 + dy * t;
    fillCircle(buf, w, px, py, thick / 2, r, g, b, a);
  }
}

// Filled convex polygon (scan-line)
function fillPoly(buf, w, pts, r, g, b, a = 255) {
  const ys = pts.map(p => p[1]);
  const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++)
        setPixel(buf, w, x, y, r, g, b, a);
  }
}

// ── Icon drawing ─────────────────────────────────────────────────────────────

function drawIcon(size) {
  const buf = new Uint8Array(size * size * 4); // RGBA, starts transparent/black

  const s = size / 512; // scale factor

  // Background rounded square
  const [bgR, bgG, bgB] = hex('#0f172a');
  fillRoundRect(buf, size, 0, 0, size, size, Math.round(112 * s), bgR, bgG, bgB);

  // Grid cells (3×3)
  const [cellR, cellG, cellB] = hex('#1e3a5f');
  const cellAlpha = 153; // ~60%
  const origins = [80, 206, 332].map(v => Math.round(v * s));
  const cellSize = Math.round(100 * s);
  const cellRadius = Math.round(18 * s);
  for (const cy of origins)
    for (const cx of origins)
      fillRoundRect(buf, size, cx, cy, cellSize, cellSize, cellRadius, cellR, cellG, cellB, cellAlpha);

  // Arrow snake body: L-shape from (130,256) → (256,256) → (256,130)
  const [arR, arG, arB] = hex('#38bdf8');
  const thick = Math.round(44 * s);
  fillLine(buf, size,
    Math.round(130 * s), Math.round(256 * s),
    Math.round(256 * s), Math.round(256 * s),
    thick, arR, arG, arB);
  fillLine(buf, size,
    Math.round(256 * s), Math.round(256 * s),
    Math.round(256 * s), Math.round(130 * s),
    thick, arR, arG, arB);

  // Arrow head (triangle pointing up)
  fillPoly(buf, size, [
    [Math.round(256 * s), Math.round(56  * s)],
    [Math.round(216 * s), Math.round(120 * s)],
    [Math.round(296 * s), Math.round(120 * s)],
  ], arR, arG, arB);

  return buf;
}

// ── Generate & write ─────────────────────────────────────────────────────────

for (const size of [192, 512]) {
  const rgba = drawIcon(size);
  const png  = encodePNG(size, size, rgba);
  const out  = join(OUT, `icon-${size}.${ICON_VERSION}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
