/** A single location fix as reported by the OS. */
export interface LocationSample {
  /** Epoch milliseconds. */
  timestamp: number;
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres. Larger means less trustworthy. */
  accuracy: number;
  /** Ground speed in m/s when the OS supplies it. */
  speed?: number | undefined;
}

/**
 * IRS deduction categories.
 *
 * `personal` is tracked but never deductible — users still want the record so
 * their business-use percentage is defensible under audit.
 *
 * `moving` is deductible only for qualified active-duty Armed Forces members
 * (the TCJA suspended it for everyone else through 2025), and shares a rate
 * with `medical`.
 */
export type TripCategory = "business" | "medical" | "moving" | "charity" | "personal";

/** A completed drive. Distances are stored in metres; miles are derived. */
export interface Trip {
  id: string;
  /** Epoch ms of the first accepted sample. */
  startedAt: number;
  /** Epoch ms of the last accepted sample. */
  endedAt: number;
  /**
   * Minutes offset from UTC at the trip's origin (as `Date#getTimezoneOffset`
   * inverted, i.e. UTC-5 is -300). Captured at trip start so the calendar date
   * used for rate lookup stays correct even if the device later crosses a
   * timezone or the user reviews the trip from elsewhere.
   */
  tzOffsetMinutes: number;
  distanceMetres: number;
  category: TripCategory;
  /** Free-text business purpose. Required by IRS recordkeeping rules. */
  purpose?: string | undefined;
  startLabel?: string | undefined;
  endLabel?: string | undefined;
  path: LocationSample[];
}

/** Why the segmenter rejected a candidate trip. Surfaced for debugging and trust. */
export type RejectionReason =
  | "below-minimum-distance"
  | "implausible-speed"
  | "insufficient-samples";

export interface RejectedSegment {
  reason: RejectionReason;
  startedAt: number;
  endedAt: number;
  distanceMetres: number;
}

export interface SegmentationResult {
  trips: Trip[];
  rejected: RejectedSegment[];
}
