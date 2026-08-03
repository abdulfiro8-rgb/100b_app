import { haversineMetres } from "./geo.js";
import type { EvidenceRecord } from "./types.js";

/**
 * Cross-checks embedded EXIF against what the app recorded.
 *
 * **EXIF is evidence, never proof.** Any byte of it can be rewritten with free
 * tools, so a photograph whose EXIF agrees with our record has demonstrated
 * nothing — a forger would make them agree. The trust anchor stays the capture
 * record and the hash chain.
 *
 * The check earns its place on *disagreement*. A file whose own metadata says
 * it was taken on a different day, or three miles away, is worth flagging to
 * whoever reads the report, whether that is tampering, a camera with a wrong
 * clock, or an image that came from somewhere other than this inspection.
 *
 * Absence is not suspicious: many pipelines strip EXIF, and PNG usually carries
 * none at all.
 */

export interface ExifFacts {
  capturedAt?: number | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export type ExifDisagreement = "time" | "location";

export interface ExifComparison {
  evidenceId: string;
  disagreements: ExifDisagreement[];
  detail: string;
}

export interface ExifOptions {
  /** Tolerated gap between EXIF time and the recorded capture time. */
  timeToleranceMs: number;
  /** Tolerated distance between EXIF coordinates and the recorded fix. */
  distanceToleranceMetres: number;
}

export const DEFAULT_EXIF_OPTIONS: ExifOptions = {
  // Cameras and phones commonly disagree by a few minutes; a whole hour apart
  // is a different claim about when the photograph was taken.
  timeToleranceMs: 60 * 60_000,
  distanceToleranceMetres: 500,
};

/**
 * Compares one record against the EXIF read from its file.
 *
 * Returns `undefined` when there is nothing to compare, which is the common
 * case and must not read as a problem.
 */
export function compareExif(
  record: EvidenceRecord,
  exif: ExifFacts | undefined,
  options: Partial<ExifOptions> = {},
): ExifComparison | undefined {
  if (!exif) return undefined;
  const opts = { ...DEFAULT_EXIF_OPTIONS, ...options };

  const disagreements: ExifDisagreement[] = [];
  const details: string[] = [];

  if (exif.capturedAt !== undefined) {
    const gap = Math.abs(exif.capturedAt - record.capturedAt);
    if (gap > opts.timeToleranceMs) {
      disagreements.push("time");
      details.push(
        `the file's own timestamp is ${describeGap(gap)} from the time recorded at capture`,
      );
    }
  }

  if (exif.latitude !== undefined && exif.longitude !== undefined && record.location) {
    const distance = haversineMetres(
      { latitude: exif.latitude, longitude: exif.longitude },
      record.location,
    );
    if (distance > opts.distanceToleranceMetres) {
      disagreements.push("location");
      details.push(
        `the file's own coordinates are about ${Math.round(distance)} m from the recorded position`,
      );
    }
  }

  if (disagreements.length === 0) return undefined;

  return {
    evidenceId: record.id,
    disagreements,
    detail: `Embedded metadata disagrees with the capture record: ${details.join(", and ")}.`,
  };
}

/**
 * Reads EXIF from image bytes.
 *
 * `exifr` is loaded on demand so it stays out of the initial bundle; EXIF is
 * only consulted when a package is verified, not on every capture.
 */
export async function readExif(bytes: Uint8Array): Promise<ExifFacts | undefined> {
  try {
    const exifr = await import("exifr");
    const parsed = (await exifr.parse(bytes as Uint8Array<ArrayBuffer>, {
      tiff: true,
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"],
    })) as Record<string, unknown> | undefined;

    if (!parsed) return undefined;

    const taken = (parsed["DateTimeOriginal"] ?? parsed["CreateDate"]) as Date | undefined;
    const latitude = parsed["latitude"] as number | undefined;
    const longitude = parsed["longitude"] as number | undefined;

    if (taken === undefined && latitude === undefined) return undefined;

    return {
      capturedAt: taken instanceof Date ? taken.getTime() : undefined,
      latitude,
      longitude,
    };
  } catch {
    // A file with no EXIF, or metadata too damaged to parse, is not itself a
    // finding — the hash chain is what carries the weight.
    return undefined;
  }
}

function describeGap(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${Math.round(hours / 24)} days`;
}
