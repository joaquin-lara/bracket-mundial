import zlib from 'zlib';
import { writeFileSync } from 'fs';

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const W = size, H = size, cx = W / 2, cy = H / 2;
  const bg = [11, 95, 58], ball = [245, 247, 245], spot = [17, 24, 20]; // green bg, white ball, dark pentagons
  const R = size * 0.34, rad = size * 0.18; // ball radius, corner radius
  const raw = Buffer.alloc(H * (1 + W * 4));
  // pentagon-ish spots: a few small dark circles on the ball
  const spots = [[0, -R * 0.55], [R * 0.5, -R * 0.1], [-R * 0.5, -R * 0.1], [R * 0.32, R * 0.45], [-R * 0.32, R * 0.45]];
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 4) + 1 + x * 4;
      const dx = x - cx, dy = y - cy;
      // rounded-square background mask
      const ax = Math.abs(dx) - (W / 2 - rad), ay = Math.abs(dy) - (H / 2 - rad);
      const qx = Math.max(ax, 0), qy = Math.max(ay, 0);
      const outside = Math.hypot(qx, qy) > rad;
      let c = outside ? [0, 0, 0] : bg, a = outside ? 0 : 255;
      const dist = Math.hypot(dx, dy);
      if (dist <= R) {
        c = ball;
        for (const [sx, sy] of spots) if (Math.hypot(dx - sx, dy - sy) <= R * 0.16) c = spot;
      }
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(`public/${name}`, png(size)); console.log('wrote public/' + name);
}
