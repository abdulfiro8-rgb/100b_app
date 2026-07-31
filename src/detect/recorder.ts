import { segmentTrips, type SegmentationOptions } from "../core/segment.js";
import type { LocationSample, Trip } from "../core/types.js";
import type { DriveDetector } from "./types.js";

/**
 * Turns a live stream of fixes into completed trips.
 *
 * Segmentation is defined over a whole trace, but a running app only ever has a
 * prefix of one. The resolution: re-segment the pending buffer as samples
 * arrive and publish every trip **except the last**, because the final segment
 * is only closed by the end of the stream and could still grow — a car stopped
 * at a long traffic light has not finished its trip. The tail is released when
 * `flush()` runs at stop time.
 */
export class TripRecorder {
  private buffer: LocationSample[] = [];
  private readonly listeners = new Set<(trip: Trip) => void>();
  private unsubscribe?: (() => void) | undefined;

  constructor(
    private readonly detector: DriveDetector,
    private readonly options: Partial<SegmentationOptions> = {},
  ) {}

  onTrip(listener: (trip: Trip) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.unsubscribe = this.detector.onSample((sample) => this.ingest(sample));
    await this.detector.start();
  }

  async stop(): Promise<void> {
    await this.detector.stop();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.flush();
  }

  /** Samples held pending, exposed for diagnostics. */
  get pending(): readonly LocationSample[] {
    return this.buffer;
  }

  ingest(sample: LocationSample): void {
    this.buffer.push(sample);

    const { trips } = segmentTrips(this.buffer, this.options);
    if (trips.length < 2) return;

    // All but the last are settled: a later segment exists, so these can no
    // longer change.
    const settled = trips.slice(0, -1);
    const tail = trips[trips.length - 1]!;

    for (const trip of settled) this.emit(trip);

    // Keep only what the unsettled tail still needs.
    this.buffer = this.buffer.filter((s) => s.timestamp >= tail.startedAt);
  }

  /** Closes out whatever remains. Call when tracking stops for good. */
  flush(): void {
    if (this.buffer.length === 0) return;
    const { trips } = segmentTrips(this.buffer, this.options);
    for (const trip of trips) this.emit(trip);
    this.buffer = [];
  }

  private emit(trip: Trip): void {
    for (const listener of this.listeners) listener(trip);
  }
}
