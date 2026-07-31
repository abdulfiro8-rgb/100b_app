import type { CaptureContext, CaptureSource, FixedLocation } from "../core/types.js";

/**
 * The seam between code that runs anywhere and code that only runs on a phone.
 *
 * Everything downstream — the chain, provenance, reporting — consumes
 * `CapturedImage` and has no idea whether it came from a camera or a fixture.
 * That is what keeps the evidence logic testable on a machine with no camera,
 * no GPS and no permissions.
 */

export interface CapturedImage {
  bytes: Uint8Array;
  mimeType: string;
  source: CaptureSource;
}

export interface CameraSource {
  readonly name: string;
  /** Open the camera. Rejects if permission is refused or capture is cancelled. */
  capture(): Promise<CapturedImage>;
  /** Pick an existing image. Recorded with a different source for a reason. */
  pickFromLibrary(): Promise<CapturedImage>;
}

export interface LocationSource {
  /** Best current fix, or `undefined` when none can be obtained. */
  current(): Promise<FixedLocation | undefined>;
}

/**
 * Split clock.
 *
 * `now` is the settable wall clock; `monotonic` cannot be wound backwards.
 * Recording both is what makes clock tampering detectable — see
 * `checkClock` in `core/provenance.ts`.
 */
export interface Clock {
  now(): number;
  monotonic(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  // performance.now() is monotonic within a process and, unlike Date.now(),
  // is unaffected by the user changing the device clock.
  monotonic: () => Math.round(performance.now()),
};

export interface CaptureDeps {
  camera: CameraSource;
  location: LocationSource;
  clock: Clock;
}

/** Assembles the immutable capture facts for one photograph. */
export async function buildContext(
  deps: CaptureDeps,
  source: CaptureSource,
): Promise<CaptureContext> {
  // Location is requested before reading the clock so the timestamp reflects
  // when the record was assembled, not when the GPS fix started resolving.
  const location = await deps.location.current();
  return {
    capturedAt: deps.clock.now(),
    monotonicMs: deps.clock.monotonic(),
    location,
    source,
  };
}
