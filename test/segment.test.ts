import { describe, expect, it } from "vitest";
import { segmentTrips } from "../src/core/segment.js";
import { metresToMiles } from "../src/core/geo.js";
import type { LocationSample } from "../src/core/types.js";
import { drive, endOf, offsetMetres, parked } from "./support/traces.js";

const HOME = { latitude: 37.7749, longitude: -122.4194 };
const NOON = Date.UTC(2026, 6, 15, 12, 0, 0);

/** Fixed offset so tests do not depend on the machine's timezone. */
const opts = { tzOffsetMinutesAt: () => -420 };

describe("phantom mileage while parked", () => {
  it("logs no trip at all for a car parked overnight", () => {
    const overnight = parked({
      startTs: NOON,
      ...HOME,
      durationMs: 8 * 60 * 60_000,
      intervalMs: 30_000,
      jitterMetres: 12,
      accuracy: 15,
    });

    const { trips } = segmentTrips(overnight, opts);

    // Naively summing haversine across these ~960 fixes invents several miles
    // of deduction out of pure noise.
    expect(trips).toHaveLength(0);
  });

  it("does not inflate a real trip with jitter from either end", () => {
    const outbound = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 20,
      durationMs: 10 * 60_000,
      bearing: 90,
    });

    const trace = [
      ...parked({ startTs: NOON - 30 * 60_000, ...HOME, durationMs: 29 * 60_000 }),
      ...outbound,
      ...parked({
        startTs: endOf(outbound).timestamp + 30_000,
        latitude: endOf(outbound).latitude,
        longitude: endOf(outbound).longitude,
        durationMs: 30 * 60_000,
      }),
    ];

    const { trips } = segmentTrips(trace, opts);
    expect(trips).toHaveLength(1);

    // The synthetic trace measures 11,986 m end to end (7.448 mi). The tolerance
    // covers jitter on the seeded origin fix, nothing more — an hour of parked
    // noise either side must not show up as distance.
    const miles = metresToMiles(trips[0]!.distanceMetres);
    expect(miles).toBeGreaterThan(7.43);
    expect(miles).toBeLessThan(7.47);
  });
});

describe("signal gaps versus genuine stops", () => {
  it("keeps one drive intact across a tunnel", () => {
    const before = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 25,
      durationMs: 5 * 60_000,
      bearing: 0,
    });

    // Four minutes of silence, emerging 6 km further on: no fixes arrive at all.
    const exit = endOf(before);
    const resumePoint = offsetMetres(exit.latitude, exit.longitude, 6000, 0);
    const after = drive({
      startTs: exit.timestamp + 4 * 60_000,
      ...resumePoint,
      speedMps: 25,
      durationMs: 5 * 60_000,
      bearing: 0,
    });

    const { trips } = segmentTrips([...before, ...after], opts);

    expect(trips).toHaveLength(1);
  });

  it("splits into two trips when the car actually stops", () => {
    const morning = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 20,
      durationMs: 10 * 60_000,
      bearing: 90,
    });
    const office = endOf(morning);

    // Same elapsed time as a long tunnel, but fixes keep arriving and show no
    // movement. That is what distinguishes a stop from lost signal.
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

    const { trips } = segmentTrips([...morning, ...waiting, ...evening], opts);

    expect(trips).toHaveLength(2);
  });

  it("splits when the phone goes dark for hours", () => {
    const first = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 20,
      durationMs: 10 * 60_000,
      bearing: 90,
    });
    const far = offsetMetres(HOME.latitude, HOME.longitude, 50_000, 0);
    const second = drive({
      startTs: NOON + 6 * 60 * 60_000,
      ...far,
      speedMps: 20,
      durationMs: 10 * 60_000,
      bearing: 90,
    });

    const { trips } = segmentTrips([...first, ...second], opts);
    expect(trips).toHaveLength(2);
  });
});

describe("things that are not drives", () => {
  it("rejects a flight instead of deducting it", () => {
    const toAirport = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 20,
      durationMs: 15 * 60_000,
      bearing: 180,
    });

    // 900 km in 90 minutes: ~167 m/s, far beyond any car.
    const gate = endOf(toAirport);
    const destination = offsetMetres(gate.latitude, gate.longitude, 900_000, 0);
    const cruise: LocationSample[] = [
      {
        timestamp: gate.timestamp + 90 * 60_000,
        latitude: destination.latitude,
        longitude: destination.longitude,
        accuracy: 10,
      },
    ];

    const { trips, rejected } = segmentTrips([...toAirport, ...cruise], opts);

    // The drive to the airport is real and should survive; the flight leg must not
    // become mileage.
    expect(trips).toHaveLength(1);
    expect(metresToMiles(trips[0]!.distanceMetres)).toBeLessThan(20);
    expect(rejected.some((r) => r.reason === "implausible-speed")).toBe(true);
  });

  it("discards a walk to the postbox as below the minimum distance", () => {
    const stroll = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 1.4,
      durationMs: 3 * 60_000,
      intervalMs: 5_000,
      bearing: 45,
    });

    const { trips, rejected } = segmentTrips(stroll, opts);

    expect(trips).toHaveLength(0);
    expect(rejected.some((r) => r.reason === "below-minimum-distance")).toBe(true);
  });

  it("ignores junk fixes with a huge accuracy radius", () => {
    const good = drive({
      startTs: NOON,
      ...HOME,
      speedMps: 20,
      durationMs: 10 * 60_000,
      bearing: 90,
    });

    // A cell-tower fix landing 5 km away with a 3 km accuracy radius.
    const junkPoint = offsetMetres(HOME.latitude, HOME.longitude, 5000, 5000);
    const withJunk = [
      ...good.slice(0, 30),
      { timestamp: good[30]!.timestamp + 1, ...junkPoint, accuracy: 3000 },
      ...good.slice(30),
    ];

    const clean = segmentTrips(good, opts);
    const dirty = segmentTrips(withJunk, opts);

    expect(dirty.trips).toHaveLength(1);
    expect(dirty.trips[0]!.distanceMetres).toBeCloseTo(clean.trips[0]!.distanceMetres, 5);
  });
});

describe("trip metadata", () => {
  it("records the timezone offset captured at trip start", () => {
    const trip = segmentTrips(
      drive({ startTs: NOON, ...HOME, speedMps: 20, durationMs: 10 * 60_000, bearing: 90 }),
      opts,
    ).trips[0]!;

    expect(trip.tzOffsetMinutes).toBe(-420);
  });

  it("defaults new trips to personal rather than assuming a deduction", () => {
    const trip = segmentTrips(
      drive({ startTs: NOON, ...HOME, speedMps: 20, durationMs: 10 * 60_000, bearing: 90 }),
      opts,
    ).trips[0]!;

    expect(trip.category).toBe("personal");
  });
});
