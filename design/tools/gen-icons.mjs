// 生成成绩单公报配色的 tabBar 图标（81×81 RGBA PNG，零依赖）
// 用法: node design/tools/gen-icons.mjs
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const SIZE = 81;
const OUT_DIR = path.resolve(process.cwd(), 'miniprogram/images');

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(filePath, px) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
  console.log('written', filePath, png.length, 'bytes');
}

// ---------- 画布与形状 ----------
const canvas = () => Buffer.alloc(SIZE * SIZE * 4); // 全透明
function put(px, x, y, [r, g, b, a = 255]) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
function fillRect(px, color, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(px, x, y, color);
}
function fillCircle(px, color, cx, cy, rad) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) put(px, x, y, color);
}
function fillTriangle(px, color, p1, p2, p3) {
  const sign = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const minX = Math.min(p1[0], p2[0], p3[0]), maxX = Math.max(p1[0], p2[0], p3[0]);
  const minY = Math.min(p1[1], p2[1], p3[1]), maxY = Math.max(p1[1], p2[1], p3[1]);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const p = [x + 0.5, y + 0.5];
      const d1 = sign(p1, p2, p), d2 = sign(p2, p3, p), d3 = sign(p3, p1, p);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) put(px, p[0], p[1], color);
    }
}
function fillDiamond(px, color, cx, cy, hw, hh) {
  for (let y = Math.floor(cy - hh); y <= cy + hh; y++)
    for (let x = Math.floor(cx - hw); x <= cx + hw; x++)
      if (Math.abs(x - cx) / hw + Math.abs(y - cy) / hh <= 1) put(px, x, y, color);
}

// ---------- 字形 ----------
// home：实心小屋（三角屋顶 + 方屋身 + 挖门）
function drawHome(px, C) {
  fillTriangle(px, C, [40.5, 13], [11, 44], [70, 44]);
  fillRect(px, C, 21, 44, 60, 67);
  fillRect(px, [0, 0, 0, 0], 35, 51, 46, 67); // 门
}
// tutor：学位帽（菱形帽板 + 帽穗 + 帽身）
function drawTutor(px, C) {
  fillDiamond(px, C, 40.5, 30, 30, 12);
  fillRect(px, C, 27, 42, 54, 63);
  fillRect(px, C, 67, 30, 71, 48);   // 帽穗垂线
  fillCircle(px, C, 69, 51, 3.2);    // 穗头
}
// mine：人形（圆头 + 肩弧）
function drawMine(px, C) {
  // 头
  fillCircle(px, C, 40.5, 30, 13);
  // 肩（半圆弧：顶部最宽，向下收）
  for (let y = 47; y <= 67; y++) {
    const half = 27 - (y - 47) * 0.18; // 顶部最宽，向下收
    for (let x = Math.round(40.5 - half); x <= Math.round(40.5 + half); x++) {
      put(px, x, y, C);
    }
  }
}

const INACTIVE = [138, 133, 116, 255]; // #8A8574 灰褐
const ACTIVE = [23, 82, 67, 255];      // #175243 墨绿

const jobs = [
  ['home.png', drawHome, INACTIVE],
  ['home-active.png', drawHome, ACTIVE],
  ['tutor.png', drawTutor, INACTIVE],
  ['tutor-active.png', drawTutor, ACTIVE],
  ['mine.png', drawMine, INACTIVE],
  ['mine-active.png', drawMine, ACTIVE],
];

for (const [name, draw, color] of jobs) {
  const px = canvas();
  draw(px, color);
  writePNG(path.join(OUT_DIR, name), px);
}
