/**
 * Generates the favicon and PWA icon set from the real logo.
 *
 *   node scripts/generate-icons.mjs
 *
 * Source: public/logo.png — the brand mark, square and with transparency. Every
 * other icon in public/ is derived from it, so the logo is replaced in one place
 * and the whole set is regenerated rather than edited by hand and drifting.
 *
 * Two kinds of output, because platforms treat them differently:
 *
 *   favicon-16/32, icon-192, icon-512, apple-touch-icon
 *       The mark, edge to edge apart from a little breathing room. Apple's is
 *       flattened onto the brand background because iOS composites the home
 *       screen icon on nothing — transparency there shows as black.
 *   icon-maskable-512
 *       Android may crop this to a circle, so the mark is inset to 60% of the
 *       canvas: everything outside the middle 80% can be cut away, and a mark
 *       that filled the square would lose its corners.
 *
 * `sharp` is a devDependency: this runs before a build, never in the browser or
 * on the server.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SOURCE = join(PUBLIC_DIR, 'logo.png');

/** slate-900, the same colour as the dark theme-color meta tag. */
const BRAND = { r: 15, g: 23, b: 42, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * One icon.
 *
 * `coverage` is how much of the canvas the mark occupies; the rest is padding,
 * added by `contain` so a non-square logo would still not be distorted.
 */
async function icon({ name, size, coverage = 0.92, background = TRANSPARENT }) {
  const inner = Math.round(size * coverage);
  const pad = Math.round((size - inner) / 2);

  const mark = await sharp(SOURCE)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();

  const buffer = await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: mark, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  writeFileSync(join(PUBLIC_DIR, name), buffer);
  return { name, bytes: buffer.length };
}

/**
 * An .ico holding the 16 and 32 pixel PNGs.
 *
 * Written by hand because it is a 22-byte header plus the PNGs themselves, and
 * `/favicon.ico` is still requested by browsers and crawlers that ignore the
 * link tags. Not worth a dependency.
 */
function ico(name, entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = header.length;
  entries.forEach(({ size, data }, index) => {
    const at = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2); // palette
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  const buffer = Buffer.concat([header, ...entries.map((entry) => entry.data)]);
  writeFileSync(join(PUBLIC_DIR, name), buffer);
  return { name, bytes: buffer.length };
}

const written = [];

written.push(await icon({ name: 'favicon-16.png', size: 16, coverage: 1 }));
written.push(await icon({ name: 'favicon-32.png', size: 32, coverage: 1 }));
written.push(await icon({ name: 'icon-192.png', size: 192 }));
written.push(await icon({ name: 'icon-512.png', size: 512 }));
written.push(
  await icon({ name: 'icon-maskable-512.png', size: 512, coverage: 0.6, background: BRAND }),
);
written.push(
  await icon({ name: 'apple-touch-icon.png', size: 180, coverage: 0.86, background: BRAND }),
);

written.push(
  ico('favicon.ico', [
    { size: 16, data: readFileSync(join(PUBLIC_DIR, 'favicon-16.png')) },
    { size: 32, data: readFileSync(join(PUBLIC_DIR, 'favicon-32.png')) },
  ]),
);

for (const { name, bytes } of written) {
  console.log(`${name.padEnd(24)} ${(bytes / 1024).toFixed(1)} kB`);
}
