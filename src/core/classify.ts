import { haversineMetres } from "./geo.js";
import { localDateOf } from "./rates.js";
import type { LocationSample, Trip, TripCategory } from "./types.js";

export interface Place {
  latitude: number;
  longitude: number;
  /** Match radius in metres. */
  radiusMetres: number;
}

/**
 * A user-defined auto-classification rule.
 *
 * Rules only fire when every specified condition matches, so a rule with no
 * conditions never applies — an empty rule silently reclassifying a whole year
 * would be the worst possible bug here.
 */
export interface Rule {
  id: string;
  name: string;
  category: TripCategory;
  purpose?: string | undefined;
  startsNear?: Place | undefined;
  endsNear?: Place | undefined;
  /** 0 = Sunday, matching `Date#getUTCDay`. */
  daysOfWeek?: number[] | undefined;
  /** Inclusive local start time, `HH:MM`. */
  fromTime?: string | undefined;
  /** Inclusive local end time, `HH:MM`. */
  toTime?: string | undefined;
}

export function ruleHasConditions(rule: Rule): boolean {
  return Boolean(
    rule.startsNear ||
      rule.endsNear ||
      (rule.daysOfWeek && rule.daysOfWeek.length > 0) ||
      rule.fromTime ||
      rule.toTime,
  );
}

export function ruleMatches(rule: Rule, trip: Trip): boolean {
  if (!ruleHasConditions(rule)) return false;

  const start = trip.path[0];
  const end = trip.path[trip.path.length - 1];
  if (!start || !end) return false;

  if (rule.startsNear && !isNear(start, rule.startsNear)) return false;
  if (rule.endsNear && !isNear(end, rule.endsNear)) return false;

  const local = new Date(trip.startedAt + trip.tzOffsetMinutes * 60_000);

  if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    if (!rule.daysOfWeek.includes(local.getUTCDay())) return false;
  }

  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (rule.fromTime !== undefined && minutes < parseHhMm(rule.fromTime)) return false;
  if (rule.toTime !== undefined && minutes > parseHhMm(rule.toTime)) return false;

  return true;
}

/**
 * Applies the first matching rule.
 *
 * Trips the user has already classified by hand are left alone: a rule added
 * later must never overwrite a deliberate decision.
 */
export function applyRules(trip: Trip, rules: readonly Rule[], manuallySet = false): Trip {
  if (manuallySet) return trip;

  const match = rules.find((rule) => ruleMatches(rule, trip));
  if (!match) return trip;

  return {
    ...trip,
    category: match.category,
    purpose: match.purpose ?? trip.purpose,
  };
}

/** Trips that would be deductible but lack the written purpose Pub. 463 requires. */
export function missingPurpose(trips: readonly Trip[]): Trip[] {
  return trips.filter((t) => t.category !== "personal" && !t.purpose?.trim());
}

/** Groups trips by their local calendar date, newest first. */
export function groupByDate(trips: readonly Trip[]): Map<string, Trip[]> {
  const grouped = new Map<string, Trip[]>();
  for (const trip of [...trips].sort((a, b) => b.startedAt - a.startedAt)) {
    const date = localDateOf(trip.startedAt, trip.tzOffsetMinutes);
    const bucket = grouped.get(date) ?? [];
    bucket.push(trip);
    grouped.set(date, bucket);
  }
  return grouped;
}

function isNear(sample: LocationSample, place: Place): boolean {
  return haversineMetres(sample, place) <= place.radiusMetres;
}

function parseHhMm(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}
