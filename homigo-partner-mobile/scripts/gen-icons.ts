/**
 * Generates valid placeholder app icons (HOMEEIGO Partner sage-emerald + white roundel) so the
 * app.json icon config is valid and the build is store-submittable. Replace with final branded
 * artwork before release. Run: bun run scripts/gen-icons.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function png(size: number, bg: [number, number, number], fg: [number, number, number], roundel: boolean): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const cx = size / 2, cy = size / 2, r = size * 0.3;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inside = roundel && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const c = inside ? fg : bg;
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
    }
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const SAGE: [number, number, number] = [61, 107, 79]; // #3d6b4f partner brand
const WHITE: [number, number, number] = [255, 255, 255];
const dir = join((import.meta as unknown as { dir: string }).dir, "..", "assets");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "icon.png"), png(1024, SAGE, WHITE, true));
writeFileSync(join(dir, "adaptive-icon.png"), png(1024, SAGE, WHITE, true));
writeFileSync(join(dir, "splash.png"), png(1024, SAGE, WHITE, true));
writeFileSync(join(dir, "favicon.png"), png(48, SAGE, WHITE, true));
console.log("✅ generated icon.png, adaptive-icon.png, splash.png, favicon.png (1024² partner brand placeholders)");
