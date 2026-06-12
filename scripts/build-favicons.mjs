#!/usr/bin/env node
// One-shot favicon raster generator for Core.
// Source: public/icon-tile.svg (standard) + public/icon-tile-16boost.svg (16px optical bump).
// Produces: favicon-16/32/48.png, apple-touch-icon (180), icon-192, icon-512, favicon.ico (16+32+48 multi-res).
//
// Run: node scripts/build-favicons.mjs
// Dev-only — not part of `npm run build`. Re-run if icon-tile sources change.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, "..", "public");

const tileStd = await readFile(path.join(pub, "icon-tile.svg"));
const tile16  = await readFile(path.join(pub, "icon-tile-16boost.svg"));

const out = async (buf, name) => {
  await writeFile(path.join(pub, name), buf);
  console.log(`  wrote public/${name} (${buf.length} B)`);
};

// PNG exports. 16 uses the optically-bumped source per design spec §2.
console.log("rasterising PNGs…");
const png16 = await sharp(tile16).resize(16, 16).png({ compressionLevel: 9 }).toBuffer();
const png32 = await sharp(tileStd).resize(32, 32).png({ compressionLevel: 9 }).toBuffer();
const png48 = await sharp(tileStd).resize(48, 48).png({ compressionLevel: 9 }).toBuffer();
const png180 = await sharp(tileStd).resize(180, 180).png({ compressionLevel: 9 }).toBuffer();
const png192 = await sharp(tileStd).resize(192, 192).png({ compressionLevel: 9 }).toBuffer();
const png512 = await sharp(tileStd).resize(512, 512).png({ compressionLevel: 9 }).toBuffer();

await out(png16, "favicon-16.png");
await out(png32, "favicon-32.png");
await out(png48, "favicon-48.png");
await out(png180, "apple-touch-icon.png");
await out(png192, "icon-192.png");
await out(png512, "icon-512.png");

// Multi-res ICO from the three small PNGs. png-to-ico packs PNG layers directly
// (each layer carries its own compression), so the resulting file stays small.
console.log("packing favicon.ico (16 + 32 + 48)…");
const ico = await pngToIco([png16, png32, png48]);
await out(ico, "favicon.ico");

console.log("done.");
