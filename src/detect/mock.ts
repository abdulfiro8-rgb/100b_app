import type { LocationSample } from "../core/types.js";
import type { DriveDetector } from "./types.js";

export interface MockDetectorOptions {
  /**
   * Wall-clock milliseconds between emitted samples. `0` replays the whole
   * trace synchronously, which is what tests want.
   */
  intervalMs?: number;
  loop?: boolean;
}

/**
 * Replays a recorded or synthetic trace.
 *
 * This is what lets the entire app — trip list, classification, reports,
 * exports — be exercised in a desktop browser with no device, no permissions
 * and no GPS. The native detectors are the only pieces it cannot stand in for.
 */
export class MockDetector implements DriveDetector {
  readonly name = "mock";

  private readonly listeners = new Set<(sample: LocationSample) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private cursor = 0;

  constructor(
    private readonly trace: readonly LocationSample[],
    private readonly options: MockDetectorOptions = {},
  ) {}

  onSample(listener: (sample: LocationSample) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    const { intervalMs = 0, loop = false } = this.options;

    if (intervalMs === 0) {
      for (const sample of this.trace) this.publish(sample);
      this.cursor = this.trace.length;
      return;
    }

    this.timer = setInterval(() => {
      const sample = this.trace[this.cursor];
      if (!sample) {
        if (loop) {
          this.cursor = 0;
          return;
        }
        void this.stop();
        return;
      }
      this.cursor += 1;
      this.publish(sample);
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private publish(sample: LocationSample): void {
    for (const listener of this.listeners) listener(sample);
  }
}
