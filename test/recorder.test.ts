import { describe, expect, it } from "vitest";
import { MockDetector } from "../src/detect/mock.js";
import { TripRecorder } from "../src/detect/recorder.js";
import { segmentTrips } from "../src/core/segment.js";
import type { Trip } from "../src/core/types.js";
import { drive, endOf, parked } from "./support/traces.js";

const HOME = { latitude: 37.7749, longitude: -122.4194 };
const NOON = Date.UTC(2026, 6, 15, 12, 0, 0);
const opts = { tzOffsetMinutesAt: () => -420 };

/** Morning drive, a stop long enough to end it, then an evening drive back. */
function twoTripDay() {
  const morning = drive({
    startTs: NOON,
    ...HOME,
    speedMps: 20,
    durationMs: 10 * 60_000,
    bearing: 90,
  });
  const office = endOf(morning);
  const waiting = parked({
    startTs: office.timestamp + 30_000,
    latitude: office.latitude,
    longitude: office.longitude,
    durationMs: 20 * 60_000,
    intervalMs: 30_000,
  });
  const evening = drive({
    startTs: endOf(waiting).timestamp + 30_000,
    latitude: office.latitude,
    longitude: office.longitude,
    speedMps: 20,
    durationMs: 10 * 60_000,
    bearing: 270,
  });
  return [...morning, ...waiting, ...evening];
}

describe("TripRecorder", () => {
  it("streams the same trips a batch segmentation would produce", async () => {
    const trace = twoTripDay();

    const recorder = new TripRecorder(new MockDetector(trace), opts);
    const streamed: Trip[] = [];
    recorder.onTrip((t) => streamed.push(t));

    await recorder.start();
    await recorder.stop();

    const batch = segmentTrips(trace, opts).trips;

    expect(streamed).toHaveLength(batch.length);
    expect(streamed.map((t) => t.id)).toEqual(batch.map((t) => t.id));
    expect(streamed.map((t) => Math.round(t.distanceMetres))).toEqual(
      batch.map((t) => Math.round(t.distanceMetres)),
    );
  });

  it("holds back the trip still in progress", async () => {
    const trace = twoTripDay();
    const recorder = new TripRecorder(new MockDetector(trace), opts);
    const streamed: Trip[] = [];
    recorder.onTrip((t) => streamed.push(t));

    await recorder.start();

    // The morning trip is settled; the evening one is not published until the
    // stream ends, because a car paused mid-route has not finished its trip.
    expect(streamed).toHaveLength(1);

    await recorder.stop();
    expect(streamed).toHaveLength(2);
  });

  it("never emits the same trip twice", async () => {
    const recorder = new TripRecorder(new MockDetector(twoTripDay()), opts);
    const streamed: Trip[] = [];
    recorder.onTrip((t) => streamed.push(t));

    await recorder.start();
    await recorder.stop();
    recorder.flush();

    expect(new Set(streamed.map((t) => t.id)).size).toBe(streamed.length);
  });

  it("discards buffered noise instead of growing without bound", async () => {
    const recorder = new TripRecorder(new MockDetector(twoTripDay()), opts);
    await recorder.start();

    // After the first trip settles, only the unsettled tail is retained rather
    // than the whole day's fixes.
    expect(recorder.pending.length).toBeLessThan(twoTripDay().length);

    await recorder.stop();
    expect(recorder.pending).toHaveLength(0);
  });

  it("emits nothing for a day the car never moved", async () => {
    const idle = parked({ startTs: NOON, ...HOME, durationMs: 8 * 60 * 60_000 });
    const recorder = new TripRecorder(new MockDetector(idle), opts);
    const streamed: Trip[] = [];
    recorder.onTrip((t) => streamed.push(t));

    await recorder.start();
    await recorder.stop();

    expect(streamed).toHaveLength(0);
  });
});
