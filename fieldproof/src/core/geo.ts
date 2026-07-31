import type { GeoPoint } from "./types.js";

/**
 * Great-circle distance in metres.
 *
 * Duplicated from Milestamp's `src/core/geo.ts` rather than imported across the
 * package boundary: the two apps are separate deployables with separate
 * tsconfigs, and fifteen lines of stable trigonometry is a smaller cost than
 * coupling them. If a third consumer appears, move it to a workspace package.
 */
const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
