/**
 * Real PNGs as data URLs, and a server-shaped evidence key, for suites that need a job photo.
 *
 * Evidence media is the image itself, stored by the server: a suite that goes through the route sends
 * a data URL; a suite that inserts a row directly uses `storedEvidenceKey` so the row looks like one the
 * server stored for that booking, partner and stage.
 *
 * The server refuses the same photo for two stages of a job, and for two jobs of one partner. A suite
 * that uploads more than once therefore needs DIFFERENT images: `pngDataUrl()` returns a new valid PNG
 * on every call (or the same one for the same seed). `PNG_DATA_URL` is one fixed image.
 */
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { serverEvidenceKey, type EvidenceStage } from "../../lib/job-evidence-media";

export const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A valid, decodable RGB PNG whose pixels come from `seed`: a different seed is a different image.
 * `declared` overrides the IHDR width/height only (to build a PNG that claims 0 or absurd dimensions).
 */
export function pngBytes(seed: string = randomUUID(), opts: { width?: number; height?: number; declared?: { width: number; height: number } } = {}): Buffer {
  const width = opts.width ?? 4;
  const height = opts.height ?? 4;
  const noise = createHash("sha256").update(seed).digest();
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0, i = 0; y < height; y++) {
    raw[i++] = 0; // filter: none
    for (let x = 0; x < width * 3; x++, i++) raw[i] = noise[(y * width * 3 + x) % noise.length]!;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.declared?.width ?? width, 0);
  ihdr.writeUInt32BE(opts.declared?.height ?? height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const dataUrl = (bytes: Buffer, mime = "image/png"): string => `data:${mime};base64,${bytes.toString("base64")}`;

/** A new valid PNG data URL on every call; the same one for the same seed. */
export const pngDataUrl = (seed?: string): string => dataUrl(pngBytes(seed));

function segment(marker: number, body: number[] | Buffer): Buffer {
  const data = Buffer.from(body);
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

/**
 * A JPEG with the structure a camera writes (SOI, JFIF, quantisation table, frame header with the
 * dimensions, scan, EOI). The scan data is filler: it is laid out like a JPEG, it is not a picture.
 */
export function jpegBytes(width = 640, height = 480, seed = "jpeg"): Buffer {
  const sof = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    segment(0xdb, [0, ...new Array(64).fill(1)]),
    segment(0xc0, sof),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    createHash("sha256").update(seed).digest().map((b) => (b === 0xff ? 0xfe : b)),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A WebP container with one of the three image chunks and the given dimensions (header only, filler payload). */
export function webpBytes(kind: "VP8 " | "VP8L" | "VP8X", width = 320, height = 240): Buffer {
  const payload = Buffer.alloc(32, 7);
  if (kind === "VP8 ") {
    payload.set([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a], 0);
    payload.writeUInt16LE(width, 6);
    payload.writeUInt16LE(height, 8);
  } else if (kind === "VP8L") {
    payload[0] = 0x2f;
    payload.writeUInt32LE((((height - 1) & 0x3fff) << 14) | ((width - 1) & 0x3fff), 1);
  } else {
    payload.fill(0, 0, 4);
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
  }
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + 8 + payload.length, 4);
  head.write("WEBP", 8, "latin1");
  head.write(kind, 12, "latin1");
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload]);
}

/** The first bytes of an iPhone HEIC file: an ISO-BMFF `ftyp` box with the given brand. */
export function heifBytes(brand = "heic"): Buffer {
  const box = Buffer.alloc(64, 0);
  box.writeUInt32BE(24, 0);
  box.write("ftyp", 4, "latin1");
  box.write(brand, 8, "latin1");
  box.write("mif1", 16, "latin1");
  box.write("heic", 20, "latin1");
  return box;
}

export const storedEvidenceKey = (bookingId: string, providerId: string, stage: EvidenceStage): string =>
  serverEvidenceKey({ bookingId, providerId, stage, id: randomUUID(), ext: ".png" });
