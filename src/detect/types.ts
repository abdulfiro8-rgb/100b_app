import type { LocationSample } from "../core/types.js";

/**
 * Source of raw location fixes.
 *
 * This interface is the seam between the part of the app that can be tested
 * anywhere and the part that only works on a phone. Everything downstream —
 * segmentation, rates, reporting — consumes `LocationSample` and has no idea
 * whether it came from a motion coprocessor or a recorded trace.
 *
 * The battery strategy lives entirely behind this interface. Rather than
 * polling GPS continuously, the native implementations idle on low-power
 * signals (iOS significant-location-change, visit monitoring and
 * `CMMotionActivity`; Android `ActivityRecognition`) and only spin up full GPS
 * once the OS reports the user is actually in a vehicle.
 */
export interface DriveDetector {
  readonly name: string;
  /** Begin listening. Resolves once the platform has granted permission and armed. */
  start(): Promise<void>;
  /** Stop listening and flush any trip still in progress. */
  stop(): Promise<void>;
  /** Subscribe to raw fixes. Returns an unsubscribe function. */
  onSample(listener: (sample: LocationSample) => void): () => void;
}

export type DetectorStatus = "idle" | "running" | "stopped";
