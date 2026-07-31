import { haversineMetres, milesToMetres } from "./geo.js";
import type {
  LocationSample,
  RejectedSegment,
  SegmentationResult,
  Trip,
} from "./types.js";

export interface SegmentationOptions {
  /** Samples with a worse accuracy radius than this are discarded as junk fixes. */
  maxAccuracyMetres: number;
  /** Displacement must exceed this multiple of the two samples' mean accuracy to count. */
  driftFactor: number;
  /** Absolute floor for the movement threshold, in metres. */
  minDriftMetres: number;
  /**
   * Implied speed a displacement must also reach to count as movement.
   *
   * Displacement alone is not enough: a wide jitter excursion while parked can
   * clear any fixed distance threshold. What it cannot do is clear it *quickly*
   * — a 25 m wander between fixes 30 s apart implies 0.8 m/s. Real driving,
   * sampled every few seconds, implies an order of magnitude more.
   */
  minMovingSpeedMps: number;
  /** Observed stationary time that ends a trip. */
  stopDurationMs: number;
  /** Candidate trips shorter than this are discarded. */
  minTripMetres: number;
  /** Anything faster than this is not a car. */
  maxPlausibleSpeedMps: number;
  /** Silence longer than this can no longer be assumed to be a tunnel. */
  maxGapBridgeMs: number;
  /** Minutes ahead of UTC at a given instant. Defaults to the host timezone. */
  tzOffsetMinutesAt: (epochMs: number) => number;
}

export const DEFAULT_OPTIONS: SegmentationOptions = {
  maxAccuracyMetres: 100,
  driftFactor: 2,
  minDriftMetres: 20,
  // ~2.2 mph: below creeping traffic, above GPS wander.
  minMovingSpeedMps: 1,
  stopDurationMs: 5 * 60_000,
  minTripMetres: milesToMetres(0.5),
  // ~150 mph. Above this it is a plane, not a commute.
  maxPlausibleSpeedMps: 67,
  maxGapBridgeMs: 10 * 60_000,
  tzOffsetMinutesAt: (epochMs) => -new Date(epochMs).getTimezoneOffset(),
};

/**
 * Turns a raw location stream into discrete trips.
 *
 * Three failure modes drive the design, and each is what makes cheap trackers
 * produce logs that fall apart under audit:
 *
 *  1. **Phantom miles while parked.** A stationary phone's fixes wander inside
 *     the accuracy radius. Summing haversine over every sample invents distance
 *     out of noise — overnight this can fabricate several miles. Movement is
 *     therefore only counted once displacement clears the *combined accuracy* of
 *     the two fixes, so noisier fixes have to move further to be believed.
 *
 *  2. **Tunnels splitting one drive into three.** Elapsed time alone cannot tell
 *     a tunnel from a car park. The discriminator is whether samples kept
 *     *arriving*: a parked car still receives jittery fixes, a tunnel goes
 *     silent. So a stop is only credited when stationary samples were actually
 *     observed, and silence is bridged instead.
 *
 *  3. **Flights logged as drives.** A 500 mph leg between two fixes is not a
 *     car, and quietly deducting it is the kind of thing that unravels a return.
 */
export function segmentTrips(
  samples: readonly LocationSample[],
  options: Partial<SegmentationOptions> = {},
): SegmentationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const trips: Trip[] = [];
  const rejected: RejectedSegment[] = [];

  /** Samples accepted into the segment currently being built. */
  let current: LocationSample[] = [];
  let lastAccepted: LocationSample | undefined;
  let lastSampleTs: number | undefined;
  /** Stationary time actually witnessed, i.e. excluding signal gaps. */
  let stationaryObservedMs = 0;

  const closeCurrent = () => {
    const finished = finalise(current, opts);
    if (finished.trip) trips.push(finished.trip);
    if (finished.rejection) rejected.push(finished.rejection);
    current = [];
    lastAccepted = undefined;
    stationaryObservedMs = 0;
  };

  for (const sample of ordered) {
    if (sample.accuracy > opts.maxAccuracyMetres) continue;

    if (!lastAccepted) {
      current = [sample];
      lastAccepted = sample;
      lastSampleTs = sample.timestamp;
      stationaryObservedMs = 0;
      continue;
    }

    const previousTs = lastSampleTs ?? sample.timestamp;
    const sinceLastSample = sample.timestamp - previousTs;
    lastSampleTs = sample.timestamp;

    const distance = haversineMetres(lastAccepted, sample);
    const elapsedSeconds = sinceLastSample / 1000;
    const speed = elapsedSeconds > 0 ? distance / elapsedSeconds : 0;

    // Checked before the gap rule so a flight is labelled as a flight rather
    // than as generic lost signal. A long gap at a *plausible* speed still
    // falls through to the gap rule below.
    if (speed > opts.maxPlausibleSpeedMps) {
      closeCurrent();
      rejected.push({
        reason: "implausible-speed",
        startedAt: previousTs,
        endedAt: sample.timestamp,
        distanceMetres: distance,
      });
      current = [sample];
      lastAccepted = sample;
      continue;
    }

    // Silence we can no longer explain away as a tunnel. Split conservatively
    // rather than inventing a straight line across an unknown interval. No
    // origin is seeded here: after an unexplained gap we cannot claim to know
    // where the vehicle set off from.
    if (sinceLastSample > opts.maxGapBridgeMs) {
      closeCurrent();
      current = [sample];
      lastAccepted = sample;
      continue;
    }

    const threshold = Math.max(
      opts.minDriftMetres,
      opts.driftFactor * ((lastAccepted.accuracy + sample.accuracy) / 2),
    );

    if (distance <= threshold || speed < opts.minMovingSpeedMps) {
      // Indistinguishable from noise. Deliberately do not advance lastAccepted:
      // that is what stops jitter accumulating into phantom mileage.
      stationaryObservedMs += sinceLastSample;
      continue;
    }

    if (stationaryObservedMs > opts.stopDurationMs) {
      // The vehicle sat still long enough to end the previous trip. Because
      // lastAccepted was deliberately frozen through the stationary period, it
      // still holds the parking spot — seed the new trip with it so the leg
      // from the kerb to the first moving fix is not silently lost. Dropping it
      // under-reports every single trip by roughly one sampling interval.
      const origin = lastAccepted;
      closeCurrent();
      current = [origin, sample];
      lastAccepted = sample;
      continue;
    }

    current.push(sample);
    lastAccepted = sample;
    stationaryObservedMs = 0;
  }

  closeCurrent();
  return { trips, rejected };
}

function finalise(
  path: LocationSample[],
  opts: SegmentationOptions,
): { trip?: Trip; rejection?: RejectedSegment } {
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return {};

  if (path.length < 2) {
    return {
      rejection: {
        reason: "insufficient-samples",
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        distanceMetres: 0,
      },
    };
  }

  let distanceMetres = 0;
  for (let i = 1; i < path.length; i++) {
    distanceMetres += haversineMetres(path[i - 1]!, path[i]!);
  }

  if (distanceMetres < opts.minTripMetres) {
    return {
      rejection: {
        reason: "below-minimum-distance",
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        distanceMetres,
      },
    };
  }

  return {
    trip: {
      id: `trip-${first.timestamp}`,
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      tzOffsetMinutes: opts.tzOffsetMinutesAt(first.timestamp),
      distanceMetres,
      // Everything starts unclassified as personal; the user promotes trips
      // deliberately, because guessing in favour of a deduction is the wrong
      // default when the number lands on a tax return.
      category: "personal",
      path,
    },
  };
}
