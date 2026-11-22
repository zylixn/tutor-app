// 生成无缝纸张噪点贴图 → 输出 base64（粘贴进 app.wxss 的 page background-image）
// 用法: node design/tools/gen-paper-tile.mjs  （或 --out <file> 写入文本文件）
import zlib from 'zlib';

const SIZE = 72;          // 平铺尺寸
const JITTER = 2;         // 每通道亮度抖动 ±2（纸张纤维感）
const FLECK_RATE = 0.006; // 0.6% 深色纤维斑点
const BASE = [247, 244, 236]; // #F7F4EC

// 简单可复现伪随机（mulberry32）
let seed = 0x9e3779b9;
function rand() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  const j = () => Math.round((rand() - 0.5) * 2 * JITTER);
  const fleck = rand() < FLECK_RATE;
  const r = BASE[0] + j() - (fleck ? 7 : 0);
  const g = BASE[1] + j() - (fleck ? 7 : 0);
  const b = BASE[2] + j() - (fleck ? 6 : 0);
  px[i * 4] = Math.max(0, Math.min(255, r));
  px[i * 4 + 1] = Math.max(0, Math.min(255, g));
  px[i * 4 + 2] = Math.max(0, Math.min(255, b));
  px[i * 4 + 3] = 255;
}

// PNG 编码
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const b64 = png.toString('base64');
const line = `url("data:image/png;base64,${b64}")`;
console.log('png bytes:', png.length, '| base64 chars:', b64.length);
const outIdx = process.argv.indexOf('--out');
if (outIdx > -1) {
  const fs = await import('fs');
  fs.writeFileSync(process.argv[outIdx + 1], line);
  console.log('written to', process.argv[outIdx + 1]);
} else {
  console.log('---BACKGROUND-VALUE-BEGIN---');
  console.log(line);
  console.log('---BACKGROUND-VALUE-END---');
}
