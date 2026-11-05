/**
 * Генерация иконок из build/icon.svg: PNG разных размеров + Windows .ico.
 * Требует sharp (npm i -D sharp) — нужен только при изменении логотипа.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Нужен sharp:  npm i -D sharp');
  process.exit(1);
}

const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const pngs = {};
for (const size of sizes) {
  pngs[size] = await sharp(svg, { density: 400 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), pngs[512]);
fs.writeFileSync(path.join(ROOT, 'build', 'icon-512.png'), pngs[512]);
fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), pngs[256]);
fs.writeFileSync(path.join(ROOT, 'web', 'icon-128.png'), pngs[128]);

/** Собираем настоящий .ico (PNG-сжатые кадры — поддерживается Windows Vista+). */
function buildIco(images) {
  const entries = Object.entries(images).map(([size, buf]) => ({ size: Number(size), buf }));
  const count = entries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  const blobs = [];
  entries.forEach((entry, i) => {
    const p = 6 + i * 16;
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, p);
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, p + 1);
    header.writeUInt8(0, p + 2); // палитра
    header.writeUInt8(0, p + 3); // reserved
    header.writeUInt16LE(1, p + 4); // planes
    header.writeUInt16LE(32, p + 6); // bpp
    header.writeUInt32LE(entry.buf.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += entry.buf.length;
    blobs.push(entry.buf);
  });
  return Buffer.concat([header, ...blobs]);
}

const icoSizes = { 16: pngs[16], 24: pngs[24], 32: pngs[32], 48: pngs[48], 64: pngs[64], 128: pngs[128], 256: pngs[256] };
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(icoSizes));
console.log('Готово: build/icon.ico, build/icon.png, build/icon-256.png, web/icon-128.png');
