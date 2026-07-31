import type { LocationSample } from "../../src/core/types.js";

/**
 * Synthetic GPS traces for tests.
 *
 * Generated rather than committed as fixture blobs so the intent of each trace
 * is readable in the test that uses it, and so an adversarial case can be tuned
 * without hunting through binary data.
 */

const METRES_PER_DEGREE_LAT = 111_320;

/** Deterministic PRNG so jitter is reproducible across runs and machines. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

export function offsetMetres(
  latitude: number,
  longitude: number,
  northMetres: number,
  eastMetres: number,
): { latitude: number; longitude: number } {
  const lat = latitude + northMetres / METRES_PER_DEGREE_LAT;
  const lon =
    longitude + eastMetres / (METRES_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180));
  return { latitude: lat, longitude: lon };
}

export interface DriveOptions {
  startTs: number;
  latitude: number;
  longitude: number;
  /** Constant ground speed, m/s. */
  speedMps: number;
  durationMs: number;
  intervalMs?: number;
  accuracy?: number;
  /** Degrees clockwise from north. */
  bearing?: number;
}

/** A vehicle travelling in a straight line at constant speed. */
export function drive(opts: DriveOptions): LocationSample[] {
  const {
    startTs,
    latitude,
    longitude,
    speedMps,
    durationMs,
    intervalMs = 5_000,
    accuracy = 8,
    bearing = 0,
  } = opts;

  const rad = (bearing * Math.PI) / 180;
  const samples: LocationSample[] = [];

  for (let elapsed = 0; elapsed <= durationMs; elapsed += intervalMs) {
    const travelled = speedMps * (elapsed / 1000);
    const point = offsetMetres(
      latitude,
      longitude,
      travelled * Math.cos(rad),
      travelled * Math.sin(rad),
    );
    samples.push({
      timestamp: startTs + elapsed,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy,
      speed: speedMps,
    });
  }

  return samples;
}

export interface ParkedOptions {
  startTs: number;
  latitude: number;
  longitude: number;
  durationMs: number;
  intervalMs?: number;
  accuracy?: number;
  /** Peak jitter excursion in metres. */
  jitterMetres?: number;
  seed?: number;
}

/**
 * A stationary vehicle still receiving fixes.
 *
 * This is the trace that fabricates mileage in naive trackers: the phone is not
 * moving, but every fix lands somewhere slightly different.
 */
export function parked(opts: ParkedOptions): LocationSample[] {
  const {
    startTs,
    latitude,
    longitude,
    durationMs,
    intervalMs = 30_000,
    accuracy = 12,
    jitterMetres = 10,
    seed = 42,
  } = opts;

  const rand = seededRandom(seed);
  const samples: LocationSample[] = [];

  for (let elapsed = 0; elapsed <= durationMs; elapsed += intervalMs) {
    const point = offsetMetres(
      latitude,
      longitude,
      (rand() - 0.5) * 2 * jitterMetres,
      (rand() - 0.5) * 2 * jitterMetres,
    );
    samples.push({
      timestamp: startTs + elapsed,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy,
      speed: 0,
    });
  }

  return samples;
}

/** Last sample of a trace, for chaining segments together. */
export function endOf(samples: LocationSample[]): LocationSample {
  const last = samples[samples.length - 1];
  if (!last) throw new Error("empty trace");
  return last;
}
