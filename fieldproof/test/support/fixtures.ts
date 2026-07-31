import { appendRecord, sha256Hex } from "../../src/core/chain.js";
import type {
  CaptureContext,
  CaptureSource,
  EvidenceRecord,
  Job,
} from "../../src/core/types.js";
import { makePng } from "./png.js";

/** 1600 Pennsylvania Ave-ish; any fixed point works. */
export const PROPERTY = { latitude: 29.7604, longitude: -95.3698 };

export const INSPECTION_START = Date.UTC(2026, 6, 20, 15, 0, 0);

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-2026-0042",
    claimNumber: "CLM-2026-0042",
    policyNumber: "HO3-889231",
    peril: "wind",
    insuredName: "R. Alvarez",
    propertyAddress: "4118 Cypress Bend Dr, Houston, TX",
    propertyLocation: PROPERTY,
    inspectorName: "J. Whitfield",
    inspectorLicense: "TX-IA-55821",
    inspectedAt: INSPECTION_START,
    tzOffsetMinutes: -300,
    ...overrides,
  };
}

/** Move a point by a distance in metres, due north. */
export function offsetMetres(
  point: { latitude: number; longitude: number },
  northMetres: number,
): { latitude: number; longitude: number } {
  return { latitude: point.latitude + northMetres / 111_320, longitude: point.longitude };
}

export interface CaptureSpec {
  /** Seconds after the inspection start. */
  atSeconds: number;
  /** Overrides the wall clock only, leaving the monotonic clock honest. */
  wallClockOverride?: number;
  location?: { latitude: number; longitude: number; accuracyMetres: number } | undefined;
  source?: CaptureSource;
  /** Distinguishes fixture images so their hashes differ. */
  colour?: [number, number, number];
}

export interface BuiltEvidence {
  records: EvidenceRecord[];
  images: Map<string, Uint8Array>;
}

/**
 * Builds a valid chain plus the image bytes backing it.
 *
 * Tests then tamper with the result in specific ways, which is far more
 * convincing than asserting against a chain that was never valid.
 */
export async function buildEvidence(
  job: Job,
  specs: readonly CaptureSpec[],
): Promise<BuiltEvidence> {
  const records: EvidenceRecord[] = [];
  const images = new Map<string, Uint8Array>();

  for (const [index, spec] of specs.entries()) {
    const bytes = makePng({ rgb: spec.colour ?? [10 + index * 20, 60, 120] });
    const id = `ev-${index}`;

    const context: CaptureContext = {
      capturedAt: spec.wallClockOverride ?? INSPECTION_START + spec.atSeconds * 1000,
      monotonicMs: spec.atSeconds * 1000,
      location:
        spec.location === undefined
          ? { ...PROPERTY, accuracyMetres: 6 }
          : spec.location,
      source: spec.source ?? "camera",
    };

    const record = await appendRecord(records, {
      id,
      jobId: job.id,
      contentHash: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
      mimeType: "image/png",
      context,
    });

    records.push(record);
    images.set(id, bytes);
  }

  return { records, images };
}

/**
 * Returns a copy with one byte flipped, counting back from the end.
 *
 * Offsets are taken from the end to land inside the compressed image data
 * rather than the PNG header, so the file stays structurally plausible — a
 * corruption that still parses is the harder case to catch.
 */
export function flipByte(bytes: Uint8Array, fromEnd: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  const index = copy.length - fromEnd;
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

/** A clean three-photo inspection, all at the property, in order. */
export function goodInspection(): CaptureSpec[] {
  return [
    { atSeconds: 0 },
    { atSeconds: 120 },
    { atSeconds: 300 },
  ];
}
