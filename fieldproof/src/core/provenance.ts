import { haversineMetres } from "./geo.js";
import type { EvidenceRecord, Job } from "./types.js";

/**
 * Semantic checks on captured evidence.
 *
 * The chain in `chain.ts` answers "was this record altered?". These answer the
 * different and equally contested question: "does this record describe a
 * photograph taken at the property, during the inspection, by this app?"
 *
 * Every check reports rather than blocks. An adjuster working a rural loss with
 * no GPS lock is doing normal work, and a tool that refuses to produce a report
 * over it will be replaced by one that does. The report states what is
 * uncertain and lets the reader weigh it.
 */

export type ProvenanceCode =
  | "far-from-property"
  | "no-location"
  | "poor-accuracy"
  | "clock-moved-backwards"
  | "clock-inconsistent"
  | "library-import"
  | "unknown-source"
  | "outside-inspection-window"
  | "exif-mismatch";

export type IssueLevel = "info" | "warning" | "critical";

export interface ProvenanceIssue {
  code: ProvenanceCode;
  level: IssueLevel;
  evidenceId: string;
  detail: string;
}

export interface ProvenanceOptions {
  /** Distance from the property beyond which a photo is questioned. */
  propertyRadiusMetres: number;
  /** Accuracy radius above which a location fix is too vague to rely on. */
  maxAccuracyMetres: number;
  /** Tolerated disagreement between wall-clock and monotonic elapsed time. */
  clockToleranceMs: number;
  /** How far from the recorded inspection time a capture may fall. */
  inspectionWindowMs: number;
}

export const DEFAULT_PROVENANCE_OPTIONS: ProvenanceOptions = {
  // Generous enough to cover a large lot, outbuildings and the street frontage.
  propertyRadiusMetres: 250,
  maxAccuracyMetres: 100,
  clockToleranceMs: 60_000,
  inspectionWindowMs: 12 * 60 * 60_000,
};

export function checkProvenance(
  records: readonly EvidenceRecord[],
  job: Job,
  options: Partial<ProvenanceOptions> = {},
): ProvenanceIssue[] {
  const opts = { ...DEFAULT_PROVENANCE_OPTIONS, ...options };
  const issues: ProvenanceIssue[] = [];

  for (const [index, record] of records.entries()) {
    issues.push(...checkLocation(record, job, opts));
    issues.push(...checkSource(record));
    issues.push(...checkWindow(record, job, opts));

    const previous = records[index - 1];
    if (previous) issues.push(...checkClock(previous, record, opts));
  }

  return issues;
}

function checkLocation(
  record: EvidenceRecord,
  job: Job,
  opts: ProvenanceOptions,
): ProvenanceIssue[] {
  if (!record.location) {
    return [
      {
        code: "no-location",
        level: "warning",
        evidenceId: record.id,
        detail: "No location was recorded, so this photo cannot be placed at the property.",
      },
    ];
  }

  const issues: ProvenanceIssue[] = [];

  if (record.location.accuracyMetres > opts.maxAccuracyMetres) {
    issues.push({
      code: "poor-accuracy",
      level: "info",
      evidenceId: record.id,
      detail: `Location accurate only to ±${Math.round(record.location.accuracyMetres)} m.`,
    });
  }

  if (job.propertyLocation) {
    const distance = haversineMetres(record.location, job.propertyLocation);
    // Charge the GPS uncertainty against the distance before judging: a fix
    // 260 m out with ±80 m accuracy is not evidence of anything.
    const worstCase = distance - record.location.accuracyMetres;

    if (worstCase > opts.propertyRadiusMetres) {
      issues.push({
        code: "far-from-property",
        level: "critical",
        evidenceId: record.id,
        detail: `Taken about ${Math.round(distance)} m from the property address.`,
      });
    }
  }

  return issues;
}

function checkSource(record: EvidenceRecord): ProvenanceIssue[] {
  if (record.source === "library") {
    return [
      {
        code: "library-import",
        level: "warning",
        evidenceId: record.id,
        detail:
          "Imported from the photo library rather than captured in the app, so its origin is not established here.",
      },
    ];
  }

  if (record.source === "unknown") {
    return [
      {
        code: "unknown-source",
        level: "warning",
        evidenceId: record.id,
        detail: "The app did not record how this image was obtained.",
      },
    ];
  }

  return [];
}

function checkWindow(
  record: EvidenceRecord,
  job: Job,
  opts: ProvenanceOptions,
): ProvenanceIssue[] {
  if (Math.abs(record.capturedAt - job.inspectedAt) <= opts.inspectionWindowMs) return [];

  return [
    {
      code: "outside-inspection-window",
      level: "warning",
      evidenceId: record.id,
      detail: "Captured well outside the recorded inspection time.",
    },
  ];
}

/**
 * Compares wall-clock movement against the monotonic clock.
 *
 * A user can set the device clock to any value, but cannot wind the monotonic
 * clock backwards. If the two disagree about how much time passed between two
 * captures, the wall clock was changed — which is the interesting signal.
 */
function checkClock(
  previous: EvidenceRecord,
  record: EvidenceRecord,
  opts: ProvenanceOptions,
): ProvenanceIssue[] {
  const wallDelta = record.capturedAt - previous.capturedAt;
  const monotonicDelta = record.monotonicMs - previous.monotonicMs;

  if (wallDelta < 0) {
    return [
      {
        code: "clock-moved-backwards",
        level: "critical",
        evidenceId: record.id,
        detail: "Recorded later in the sequence but timestamped earlier than the photo before it.",
      },
    ];
  }

  // A negative monotonic delta means the app restarted and its monotonic origin
  // reset. That is ordinary, and says nothing about the wall clock.
  if (monotonicDelta < 0) return [];

  if (Math.abs(wallDelta - monotonicDelta) > opts.clockToleranceMs) {
    return [
      {
        code: "clock-inconsistent",
        level: "critical",
        evidenceId: record.id,
        detail:
          "Device clock and elapsed-time clock disagree about the gap since the previous photo, which happens when the clock is changed mid-inspection.",
      },
    ];
  }

  return [];
}
