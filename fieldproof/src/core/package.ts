import { unzipSync, zipSync } from "fflate";
import type { EvidencePackage } from "./verify.js";
import type { EvidenceAnnotation, EvidenceRecord, Finding, Job } from "./types.js";

/**
 * The `.fpx` portable evidence package.
 *
 * Without this the product's central claim is hollow: verification that only
 * works inside the app that produced the evidence proves nothing to the person
 * on the other side of a disputed claim. A package has to travel.
 *
 * It is an ordinary zip, deliberately. A claims examiner with no special
 * software can open it, read `manifest.json` and look at the photographs
 * directly — which matters, because a format only this app can read would be
 * asking for the same trust the package exists to replace.
 *
 * ```
 * manifest.json          job, records, annotations, findings
 * evidence/<id>.<ext>    one file per record, named by evidence id
 * README.txt             what the package is and how to check it
 * ```
 */

export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = ".fpx";

/** Earliest timestamp the zip format can store. Used to pin entry dates. */
const ZIP_EPOCH = Date.UTC(1980, 0, 1);

export interface PackageManifest {
  format: "fieldproof-evidence";
  version: number;
  exportedAt: number;
  job: Job;
  records: EvidenceRecord[];
  annotations: EvidenceAnnotation[];
  findings: Finding[];
  /** Evidence id to the file name holding its bytes. */
  files: Record<string, string>;
}

export class PackageFormatError extends Error {}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};

function fileNameFor(record: EvidenceRecord): string {
  return `evidence/${record.id}.${EXTENSIONS[record.mimeType] ?? "bin"}`;
}

const README = `Fieldproof evidence package
===========================

This is a standard zip archive. You can open it with any unzip tool.

  manifest.json        the inspection record: job details, findings, and one
                       entry per photograph including the SHA-256 hash, time,
                       location and source captured at the moment it was taken.
  evidence/            the photographs themselves, named by evidence id.

To check it independently, hash any file in evidence/ with SHA-256 and compare
it to the contentHash recorded for that id in manifest.json. Each record also
carries a recordHash covering its own details and the previous record's hash,
so photographs cannot be edited, reordered, added or removed without breaking
the chain.

What this establishes: the files are identical to those recorded during the
inspection, and their capture details have not been altered since.

What it does not establish: that a photograph depicts the property it is filed
against, that the device clock was correct, that the reported location was
genuine, or that the image reached the app from the camera rather than another
source.
`;

/** Serialises a package to `.fpx` bytes. */
export function writePackage(
  pkg: EvidencePackage,
  images: ReadonlyMap<string, Uint8Array>,
  exportedAt = Date.now(),
): Uint8Array {
  const files: Record<string, string> = {};
  const entries: Record<string, Uint8Array> = {};

  for (const record of pkg.records) {
    const bytes = images.get(record.id);
    // Exporting a package with a photograph missing would produce something
    // that fails verification on arrival for reasons the sender could have
    // seen. Better to refuse than to ship a broken package.
    if (!bytes) {
      throw new PackageFormatError(
        `Cannot export: the image for ${record.id} is missing from this device.`,
      );
    }

    const name = fileNameFor(record);
    files[record.id] = name;
    entries[name] = bytes;
  }

  const manifest: PackageManifest = {
    format: "fieldproof-evidence",
    version: PACKAGE_VERSION,
    exportedAt,
    job: pkg.job,
    records: pkg.records,
    annotations: pkg.annotations,
    findings: pkg.findings,
    files,
  };

  entries["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  entries["README.txt"] = new TextEncoder().encode(README);

  // Entry timestamps are pinned so the same package exports byte-identically.
  // Zip cannot represent a zero date — its range starts at 1980 — so the epoch
  // used here is the earliest it can hold.
  return zipSync(entries, { level: 6, mtime: ZIP_EPOCH });
}

export interface ReadPackageResult {
  pkg: EvidencePackage;
  images: Map<string, Uint8Array>;
  exportedAt: number;
}

/**
 * Parses `.fpx` bytes back into a package and its images.
 *
 * Structural problems throw; evidentiary problems do not. A package whose
 * hashes do not match is not malformed — it is exactly what the verifier exists
 * to report on, so it must survive parsing and reach `verifyPackage`.
 */
export function readPackage(bytes: Uint8Array): ReadPackageResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (cause) {
    throw new PackageFormatError("Not a readable package archive.", { cause });
  }

  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new PackageFormatError("Package has no manifest.json.");

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as PackageManifest;
  } catch (cause) {
    throw new PackageFormatError("manifest.json is not valid JSON.", { cause });
  }

  if (manifest.format !== "fieldproof-evidence") {
    throw new PackageFormatError("Not a Fieldproof evidence package.");
  }
  if (manifest.version > PACKAGE_VERSION) {
    throw new PackageFormatError(
      `Package format version ${manifest.version} is newer than this app understands.`,
    );
  }
  if (!Array.isArray(manifest.records) || !manifest.job) {
    throw new PackageFormatError("Manifest is missing its job or records.");
  }

  const images = new Map<string, Uint8Array>();
  for (const record of manifest.records) {
    const name = manifest.files?.[record.id] ?? fileNameFor(record);
    const data = entries[name];
    // A missing file is reported by the verifier as unverifiable rather than
    // rejected here, so a partially recovered package can still be examined.
    if (data) images.set(record.id, data);
  }

  return {
    pkg: {
      job: manifest.job,
      records: manifest.records,
      annotations: manifest.annotations ?? [],
      findings: manifest.findings ?? [],
    },
    images,
    exportedAt: manifest.exportedAt,
  };
}

export function packageFileName(job: Job): string {
  const safe = job.claimNumber.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safe}${PACKAGE_EXTENSION}`;
}
