/**
 * Generates the PWA icon set from code — no binary assets in git, no image
 * dependency, and the brand colour lives in exactly one place.
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes public/icon-192.png, icon-512.png, icon-maskable-512.png and
 * apple-touch-icon.png: a rounded brand-coloured tile with a white "A".
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BRAND = [15, 23, 42]; // slate-900, matches the theme-color meta tag
const INK = [255, 255, 255];

/** Signed distance from point (x, y) to the segment (x1, y1)–(x2, y2). */
function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Coverage of the glyph at a pixel, in 0..1. Sampled 3×3 per pixel so the
 * diagonals come out smooth instead of jagged.
 */
function glyphCoverage(px, py, size, stroke) {
  // "A" as three strokes, laid out on a 0..1 box inset from the tile edges.
  const inset = size * 0.28;
  const top = size * 0.24;
  const bottom = size - size * 0.24;
  const apexX = size / 2;
  const legs = [
    [apexX, top, inset, bottom],
    [apexX, top, size - inset, bottom],
    // Crossbar, pulled in so it meets the legs rather than overhanging.
    [size * 0.355, size * 0.66, size * 0.645, size * 0.66],
  ];

  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      const inGlyph = legs.some(
        ([x1, y1, x2, y2]) => distanceToSegment(x, y, x1, y1, x2, y2) <= stroke / 2,
      );
      if (inGlyph) hits += 1;
    }
  }
  return hits / 9;
}

/** Coverage of the rounded tile itself, so the corners are anti-aliased too. */
function tileCoverage(px, py, size, radius) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      const cx = Math.min(Math.max(x, radius), size - radius);
      const cy = Math.min(Math.max(y, radius), size - radius);
      if (Math.hypot(x - cx, y - cy) <= radius) hits += 1;
    }
  }
  return hits / 9;
}

function mix(from, to, amount) {
  return Math.round(from + (to - from) * amount);
}

/**
 * @param size    pixel dimensions of the square icon
 * @param maskable when true the glyph shrinks into the safe zone and the tile
 *                 is a full-bleed square, as Android's mask requires
 */
function renderIcon(size, maskable) {
  const scale = maskable ? 0.66 : 1; // safe zone for maskable icons
  const radius = maskable ? 0 : size * 0.22;
  const stroke = size * scale * 0.11;
  const offset = (size - size * scale) / 2;

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const tile = maskable ? 1 : tileCoverage(x, y, size, radius);
      const glyph = glyphCoverage(x - offset, y - offset, size * scale, stroke);
      const index = (y * size + x) * 4;
      pixels[index] = mix(BRAND[0], INK[0], glyph);
      pixels[index + 1] = mix(BRAND[1], INK[1], glyph);
      pixels[index + 2] = mix(BRAND[2], INK[2], glyph);
      pixels[index + 3] = Math.round(tile * 255);
    }
  }
  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal 8-bit RGBA PNG encoder (filter type 0 on every scanline). */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlacing.

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const { file, size, maskable } of targets) {
  writeFileSync(join(OUT_DIR, file), encodePng(renderIcon(size, maskable), size));
  console.log(`public/${file} (${size}×${size})`);
}
