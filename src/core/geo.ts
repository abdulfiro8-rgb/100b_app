import type { LocationSample } from "./types.js";

/** Mean Earth radius in metres (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;

export const METRES_PER_MILE = 1609.344;

export function metresToMiles(metres: number): number {
  return metres / METRES_PER_MILE;
}

export function milesToMetres(miles: number): number {
  return miles * METRES_PER_MILE;
}

/**
 * Great-circle distance in metres.
 *
 * Uses the haversine formula, which stays numerically stable for the short
 * distances between consecutive GPS fixes — the law-of-cosines alternative
 * loses precision badly under a few hundred metres.
 */
export function haversineMetres(
  a: Pick<LocationSample, "latitude" | "longitude">,
  b: Pick<LocationSample, "latitude" | "longitude">,
): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Implied ground speed in m/s between two samples. Returns 0 for zero elapsed time. */
export function impliedSpeedMps(a: LocationSample, b: LocationSample): number {
  const seconds = (b.timestamp - a.timestamp) / 1000;
  if (seconds <= 0) return 0;
  return haversineMetres(a, b) / seconds;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
