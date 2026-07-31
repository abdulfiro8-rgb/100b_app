import type { FixedLocation } from "../core/types.js";
import type { CameraSource, CapturedImage, Clock, LocationSource } from "./types.js";

/**
 * Fixtures standing in for the phone.
 *
 * These let the whole app be driven in a desktop browser — capture a photo,
 * build the chain, generate the report — with no device and no permissions.
 */

/** A solid-colour PNG, generated so successive captures differ. */
export function syntheticPng(seed: number): Uint8Array {
  const size = 48;
  const r = (seed * 67) % 200;
  const g = (seed * 113) % 200;
  const b = (seed * 191) % 200;

  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunks: number[] = [...header];

  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, size);
  new DataView(ihdr.buffer).setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  chunks.push(...encodeChunk("IHDR", ihdr));

  const raw: number[] = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) {
      // A soft gradient so the fixtures look like photographs rather than swatches.
      raw.push((r + x * 2) % 256, (g + y * 2) % 256, b % 256);
    }
  }
  chunks.push(...encodeChunk("IDAT", storedDeflate(new Uint8Array(raw))));
  chunks.push(...encodeChunk("IEND", new Uint8Array(0)));

  return new Uint8Array(chunks);
}

export class MockCamera implements CameraSource {
  readonly name = "mock";
  private counter = 0;

  async capture(): Promise<CapturedImage> {
    return { bytes: syntheticPng(++this.counter), mimeType: "image/png", source: "camera" };
  }

  async pickFromLibrary(): Promise<CapturedImage> {
    return { bytes: syntheticPng(++this.counter), mimeType: "image/png", source: "library" };
  }
}

export class MockLocation implements LocationSource {
  constructor(private readonly fix: FixedLocation | undefined) {}

  async current(): Promise<FixedLocation | undefined> {
    return this.fix;
  }
}

/** Advances in fixed steps so tests and demos are reproducible. */
export class MockClock implements Clock {
  private elapsed = 0;

  constructor(
    private readonly start: number,
    private readonly stepMs = 60_000,
  ) {}

  now(): number {
    return this.start + this.elapsed;
  }

  monotonic(): number {
    return this.elapsed;
  }

  advance(ms = this.stepMs): void {
    this.elapsed += ms;
  }
}

/* -------------------------------------------------------------------------- */

function encodeChunk(type: string, data: Uint8Array): number[] {
  const typeBytes = [...new TextEncoder().encode(type)];
  const body = [...typeBytes, ...data];
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(new Uint8Array(body)));
  return [...length, ...body, ...crc];
}

/**
 * zlib stream using stored (uncompressed) deflate blocks.
 *
 * Avoids pulling in a compressor: the browser has no `node:zlib`, and these
 * fixtures are tiny, so storing them raw is simpler than shipping a deflate
 * implementation for demo images.
 */
function storedDeflate(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01]; // zlib header, no compression
  const MAX = 0xffff;

  for (let offset = 0; offset < data.length; offset += MAX) {
    const slice = data.subarray(offset, Math.min(offset + MAX, data.length));
    const final = offset + MAX >= data.length ? 1 : 0;
    blocks.push(final, slice.length & 0xff, (slice.length >> 8) & 0xff);
    blocks.push(~slice.length & 0xff, (~slice.length >> 8) & 0xff);
    blocks.push(...slice);
  }

  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push((b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff);

  return new Uint8Array(blocks);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
