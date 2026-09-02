import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BACKGROUND = [15, 17, 21];
const UP = [38, 166, 91];
const DOWN = [214, 69, 69];
const WICK = [200, 205, 215];

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function fillRect(pixels, size, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(size, Math.round(y1)); y += 1) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(size, Math.round(x1)); x += 1) {
      const offset = (y * size + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
}

function candle(pixels, size, centerX, top, bottom, wickTop, wickBottom, color) {
  const bodyWidth = Math.round(size * 0.12);
  const wickWidth = Math.max(2, Math.round(size * 0.02));
  fillRect(
    pixels,
    size,
    centerX - wickWidth / 2,
    wickTop,
    centerX + wickWidth / 2,
    wickBottom,
    WICK,
  );
  fillRect(pixels, size, centerX - bodyWidth / 2, top, centerX + bodyWidth / 2, bottom, color);
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  fillRect(pixels, size, 0, 0, size, size, BACKGROUND);
  const unit = size / 100;
  candle(pixels, size, 28 * unit, 42 * unit, 70 * unit, 34 * unit, 78 * unit, DOWN);
  candle(pixels, size, 50 * unit, 30 * unit, 62 * unit, 22 * unit, 68 * unit, UP);
  candle(pixels, size, 72 * unit, 20 * unit, 50 * unit, 14 * unit, 58 * unit, UP);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * size * 3, (y + 1) * size * 3));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("apps/web/public/icons", { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`apps/web/public/icons/icon-${size}.png`, renderIcon(size));
}
