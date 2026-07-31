import type { CaptureContext, EvidenceRecord } from "./types.js";

/**
 * Tamper-evident chain over captured evidence.
 *
 * ## What this proves, and what it does not
 *
 * Each record's hash covers its own capture facts *and* the previous record's
 * hash, so altering a photo, editing a timestamp, reordering the sequence or
 * deleting a record from the middle all break the chain in a way that is
 * detectable and localisable.
 *
 * It proves the record has not changed **since the app wrote it**. It does not
 * prove the photo depicts the property, that the device clock was honest, that
 * GPS was not spoofed, or that an image was not injected into the app. Those
 * need trusted timestamping and device attestation, which are deliberately out
 * of scope for now — but the record layout leaves room for both.
 *
 * The product language is therefore "tamper-evident chain of custody from
 * capture", never "tamper-proof". Overstating this is not a marketing quibble:
 * an adjuster who repeats the stronger claim under cross-examination and is
 * taken apart on it has been actively harmed by the tool.
 *
 * ## Why mutable data is excluded
 *
 * Only immutable capture facts are hashed. Captions, finding links and report
 * text are written and rewritten long after the inspection, which is ordinary
 * work — if they were chained, normal editing would raise a tamper alarm. A
 * verifier that cries wolf on honest work gets switched off, and then it
 * protects nobody.
 */

const DOMAIN = "fieldproof/v1";

/** Immutable fields covered by `recordHash`. */
type HashedFields = Pick<
  EvidenceRecord,
  | "sequence"
  | "jobId"
  | "contentHash"
  | "byteLength"
  | "mimeType"
  | "capturedAt"
  | "monotonicMs"
  | "location"
  | "source"
  | "previousHash"
>;

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Deterministic JSON with sorted keys.
 *
 * `JSON.stringify` preserves insertion order, so two records with identical
 * content but different key order would hash differently. Sorting removes that
 * as a source of spurious verification failures.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

/**
 * Starting link for a job's chain.
 *
 * Derived from the job id so a chain cannot be lifted from one job and
 * presented as another's — the genesis link would not match.
 */
export function genesisHash(jobId: string): Promise<string> {
  return sha256Hex(`${DOMAIN}/genesis:${jobId}`);
}

export function computeRecordHash(fields: HashedFields): Promise<string> {
  return sha256Hex(`${DOMAIN}/record:${canonicalise(fields)}`);
}

export interface AppendInput {
  id: string;
  jobId: string;
  contentHash: string;
  byteLength: number;
  mimeType: string;
  context: CaptureContext;
}

/**
 * Appends a record to an existing chain.
 *
 * The caller supplies the chain so far; the sequence number and previous link
 * are derived rather than passed, because those are exactly the fields an
 * attacker would want control of.
 */
export async function appendRecord(
  chain: readonly EvidenceRecord[],
  input: AppendInput,
): Promise<EvidenceRecord> {
  const last = chain[chain.length - 1];
  const previousHash = last ? last.recordHash : await genesisHash(input.jobId);
  const sequence = last ? last.sequence + 1 : 0;

  const fields: HashedFields = {
    sequence,
    jobId: input.jobId,
    contentHash: input.contentHash,
    byteLength: input.byteLength,
    mimeType: input.mimeType,
    capturedAt: input.context.capturedAt,
    monotonicMs: input.context.monotonicMs,
    location: input.context.location,
    source: input.context.source,
    previousHash,
  };

  return {
    id: input.id,
    ...fields,
    recordHash: await computeRecordHash(fields),
  };
}

export type ChainIssueCode =
  | "record-hash-mismatch"
  | "broken-link"
  | "sequence-gap"
  | "wrong-job"
  | "genesis-mismatch";

export interface ChainIssue {
  code: ChainIssueCode;
  /** Index within the supplied array, which may differ from `sequence`. */
  index: number;
  evidenceId: string;
  detail: string;
}

/**
 * Verifies chain structure. Does not touch image bytes — that is `verifyPackage`
 * in `verify.ts`, which needs the files themselves.
 */
export async function verifyChain(
  records: readonly EvidenceRecord[],
  jobId: string,
): Promise<ChainIssue[]> {
  const issues: ChainIssue[] = [];
  const genesis = await genesisHash(jobId);

  for (const [index, record] of records.entries()) {
    if (record.jobId !== jobId) {
      issues.push({
        code: "wrong-job",
        index,
        evidenceId: record.id,
        detail: `Record belongs to job ${record.jobId}, not ${jobId}.`,
      });
    }

    const expectedPrevious = index === 0 ? genesis : records[index - 1]!.recordHash;
    if (record.previousHash !== expectedPrevious) {
      issues.push({
        code: index === 0 ? "genesis-mismatch" : "broken-link",
        index,
        evidenceId: record.id,
        detail:
          index === 0
            ? "First record does not link to this job's genesis hash."
            : "Record does not link to the preceding record — evidence may have been removed or reordered.",
      });
    }

    const expectedSequence = index === 0 ? 0 : records[index - 1]!.sequence + 1;
    if (record.sequence !== expectedSequence) {
      issues.push({
        code: "sequence-gap",
        index,
        evidenceId: record.id,
        detail: `Expected sequence ${expectedSequence}, found ${record.sequence}.`,
      });
    }

    const recomputed = await computeRecordHash({
      sequence: record.sequence,
      jobId: record.jobId,
      contentHash: record.contentHash,
      byteLength: record.byteLength,
      mimeType: record.mimeType,
      capturedAt: record.capturedAt,
      monotonicMs: record.monotonicMs,
      location: record.location,
      source: record.source,
      previousHash: record.previousHash,
    });

    if (recomputed !== record.recordHash) {
      issues.push({
        code: "record-hash-mismatch",
        index,
        evidenceId: record.id,
        detail: "Recorded capture details do not match their signature — a field was edited.",
      });
    }
  }

  return issues;
}
