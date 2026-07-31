import { sha256Hex, verifyChain, type ChainIssue } from "./chain.js";
import { checkProvenance, type ProvenanceIssue, type ProvenanceOptions } from "./provenance.js";
import type { EvidenceAnnotation, EvidenceRecord, Finding, Job } from "./types.js";

export interface EvidencePackage {
  job: Job;
  records: EvidenceRecord[];
  annotations: EvidenceAnnotation[];
  findings: Finding[];
}

export type ContentIssueCode = "content-mismatch" | "size-mismatch" | "content-missing";

export interface ContentIssue {
  code: ContentIssueCode;
  evidenceId: string;
  detail: string;
}

/**
 * Integrity outcome.
 *
 * Integrity and provenance are reported separately on purpose. "The file was
 * not altered" and "the photo was taken at the property during the inspection"
 * are different claims with different consequences, and blending them into one
 * score would let a serious provenance question hide behind an intact chain,
 * or a clean inspection look compromised because one photo lacked GPS.
 */
export interface IntegrityReport {
  verifiedAt: number;
  jobId: string;
  recordCount: number;
  /** Records whose bytes were supplied and matched their recorded hash. */
  contentVerified: number;
  integrity: "intact" | "broken";
  provenance: "clean" | "questions";
  chainIssues: ChainIssue[];
  contentIssues: ContentIssue[];
  provenanceIssues: ProvenanceIssue[];
}

/**
 * What a passing report does and does not establish.
 *
 * Carried as data so the UI and the PDF render the same wording, and so the
 * limits travel with the report rather than living only in a marketing page.
 */
export const INTEGRITY_STATEMENT = {
  establishes: [
    "The photographs are byte-for-byte identical to those recorded during the inspection.",
    "The capture details — time, location, order and source — have not been edited since.",
    "No photograph has been inserted into or removed from the middle of the sequence.",
  ],
  doesNotEstablish: [
    "That a photograph depicts the property it is filed against.",
    "That the device's clock was set correctly.",
    "That the device's reported location was genuine, which software can spoof.",
    "That the image reached the app from the camera lens rather than another source.",
  ],
} as const;

/**
 * Verifies a package against the image bytes it claims to describe.
 *
 * @param images Evidence id to image bytes. Records with no entry are reported
 *   as unverifiable rather than assumed good — silence is not a pass.
 */
export async function verifyPackage(
  pkg: EvidencePackage,
  images: ReadonlyMap<string, Uint8Array>,
  provenanceOptions: Partial<ProvenanceOptions> = {},
): Promise<IntegrityReport> {
  const chainIssues = await verifyChain(pkg.records, pkg.job.id);
  const contentIssues: ContentIssue[] = [];
  let contentVerified = 0;

  for (const record of pkg.records) {
    const bytes = images.get(record.id);

    if (!bytes) {
      contentIssues.push({
        code: "content-missing",
        evidenceId: record.id,
        detail: "The image file was not supplied, so its contents could not be checked.",
      });
      continue;
    }

    if (bytes.byteLength !== record.byteLength) {
      contentIssues.push({
        code: "size-mismatch",
        evidenceId: record.id,
        detail: `Image is ${bytes.byteLength} bytes; ${record.byteLength} were recorded.`,
      });
    }

    const actual = await sha256Hex(bytes);
    if (actual !== record.contentHash) {
      contentIssues.push({
        code: "content-mismatch",
        evidenceId: record.id,
        detail: "Image contents do not match the hash recorded at capture — the file was modified.",
      });
      continue;
    }

    contentVerified += 1;
  }

  const provenanceIssues = checkProvenance(pkg.records, pkg.job, provenanceOptions);

  // A missing file is not proof of tampering — it is an incomplete package. Only
  // a positive mismatch breaks integrity.
  const tampered = contentIssues.some(
    (i) => i.code === "content-mismatch" || i.code === "size-mismatch",
  );

  return {
    verifiedAt: Date.now(),
    jobId: pkg.job.id,
    recordCount: pkg.records.length,
    contentVerified,
    integrity: chainIssues.length > 0 || tampered ? "broken" : "intact",
    provenance: provenanceIssues.length > 0 ? "questions" : "clean",
    chainIssues,
    contentIssues,
    provenanceIssues,
  };
}

/** One-line summary for the report header and the UI badge. */
export function summariseIntegrity(report: IntegrityReport): string {
  if (report.integrity === "broken") {
    const count = report.chainIssues.length + report.contentIssues.length;
    return `Integrity check failed — ${count} problem${count === 1 ? "" : "s"} found`;
  }

  const verified = `${report.contentVerified} of ${report.recordCount} photographs verified`;
  if (report.provenance === "questions") {
    const n = report.provenanceIssues.length;
    return `${verified}; ${n} provenance note${n === 1 ? "" : "s"}`;
  }

  return `${verified}; no provenance questions`;
}
