export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface FixedLocation extends GeoPoint {
  /** Horizontal accuracy radius in metres. */
  accuracyMetres: number;
}

/**
 * Where an image came from.
 *
 * The distinction matters more than it looks: an adjuster is expected to
 * photograph the property during the inspection. An image pulled from the photo
 * library could be from another job, another date, or another property, so it
 * gets a different evidentiary weight — but only if the difference was recorded
 * at the time.
 */
export type CaptureSource = "camera" | "library" | "unknown";

/** Facts recorded at the moment of capture. None of these are editable later. */
export interface CaptureContext {
  /** Device wall clock, epoch ms. Trusted only as far as the device is. */
  capturedAt: number;
  /**
   * Milliseconds from a monotonic clock that cannot be set backwards.
   *
   * Recorded alongside the wall clock so the two can be compared: if wall-clock
   * time moves backwards or jumps while monotonic time advances steadily, the
   * device clock was changed mid-inspection.
   */
  monotonicMs: number;
  location?: FixedLocation | undefined;
  source: CaptureSource;
}

/**
 * One immutable piece of captured evidence.
 *
 * Every field here is part of the hash chain, which is why none of them are
 * editable. Captions and finding links live in `EvidenceAnnotation` instead —
 * see the note in `chain.ts` on why mutable data must stay outside the chain.
 */
export interface EvidenceRecord {
  id: string;
  jobId: string;
  /** Position in the capture order, starting at 0. */
  sequence: number;
  /** SHA-256 of the image bytes, lowercase hex. */
  contentHash: string;
  byteLength: number;
  mimeType: string;
  capturedAt: number;
  monotonicMs: number;
  location?: FixedLocation | undefined;
  source: CaptureSource;
  /** `recordHash` of the previous record, or the job's genesis hash. */
  previousHash: string;
  /** SHA-256 over this record's immutable fields together with `previousHash`. */
  recordHash: string;
}

/**
 * Editable metadata about a piece of evidence.
 *
 * Deliberately separate from `EvidenceRecord`: writing a caption an hour after
 * the inspection is normal work, not tampering, and must not invalidate the
 * chain.
 */
export interface EvidenceAnnotation {
  evidenceId: string;
  caption?: string | undefined;
  findingId?: string | undefined;
}

export type Severity = "minor" | "moderate" | "severe" | "total";

export interface Finding {
  id: string;
  /** Room or area, e.g. "Kitchen", "Roof — north slope". */
  area: string;
  description: string;
  severity: Severity;
  /** Evidence supporting this finding. */
  evidenceIds: string[];
}

export type Peril =
  | "wind"
  | "hail"
  | "water"
  | "fire"
  | "flood"
  | "impact"
  | "theft"
  | "other";

export interface Job {
  id: string;
  claimNumber: string;
  policyNumber?: string | undefined;
  peril: Peril;
  insuredName: string;
  propertyAddress: string;
  /** Geocoded property location, used to check where photos were taken. */
  propertyLocation?: GeoPoint | undefined;
  inspectorName: string;
  inspectorLicense?: string | undefined;
  inspectedAt: number;
  /** Minutes ahead of UTC at the property, so report dates read locally. */
  tzOffsetMinutes: number;
}
