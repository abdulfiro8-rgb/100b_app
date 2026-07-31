import { metresToMiles } from "./geo.js";
import { deductionCents, formatRate, localDateOf, rateFor, ratePeriodFor } from "./rates.js";
import type { Trip, TripCategory } from "./types.js";

/** A trip with its tax figures resolved. */
export interface PricedTrip {
  trip: Trip;
  /** Local calendar date the trip started, `YYYY-MM-DD`. */
  date: string;
  miles: number;
  /** Rate applied, in tenths of a cent per mile. */
  rateTenthsOfCent: number;
  deductionCents: number;
}

export interface CategoryTotal {
  category: TripCategory;
  trips: number;
  miles: number;
  deductionCents: number;
}

/** Totals for one IRS rate period, so a midyear change is visible rather than buried. */
export interface PeriodTotal {
  from: string;
  to: string;
  source: string;
  rateTenthsOfCent: number;
  miles: number;
  deductionCents: number;
}

export interface YearSummary {
  year: number;
  totalTrips: number;
  totalMiles: number;
  deductibleMiles: number;
  totalDeductionCents: number;
  byCategory: CategoryTotal[];
  /** Business-mileage breakdown per rate period. Empty when no business trips. */
  businessByPeriod: PeriodTotal[];
}

export function priceTrip(trip: Trip): PricedTrip {
  const date = localDateOf(trip.startedAt, trip.tzOffsetMinutes);
  const miles = metresToMiles(trip.distanceMetres);
  return {
    trip,
    date,
    miles,
    rateTenthsOfCent: rateFor(trip.category, date),
    deductionCents: deductionCents(miles, trip.category, date),
  };
}

export function tripYear(trip: Trip): number {
  return Number(localDateOf(trip.startedAt, trip.tzOffsetMinutes).slice(0, 4));
}

/**
 * Year-end totals.
 *
 * Every figure is summed from per-trip deductions that were each priced at the
 * rate in effect on their own date. It is never `totalMiles * someAnnualRate` —
 * in a year with a midyear rate change that shortcut produces a number that is
 * simply wrong, and it is wrong on a tax return.
 */
export function summariseYear(trips: readonly Trip[], year: number): YearSummary {
  const priced = trips.filter((t) => tripYear(t) === year).map(priceTrip);

  const byCategory = new Map<TripCategory, CategoryTotal>();
  const byPeriod = new Map<string, PeriodTotal>();

  let totalMiles = 0;
  let deductibleMiles = 0;
  let totalDeductionCents = 0;

  for (const p of priced) {
    totalMiles += p.miles;
    totalDeductionCents += p.deductionCents;
    if (p.trip.category !== "personal") deductibleMiles += p.miles;

    const cat = byCategory.get(p.trip.category) ?? {
      category: p.trip.category,
      trips: 0,
      miles: 0,
      deductionCents: 0,
    };
    cat.trips += 1;
    cat.miles += p.miles;
    cat.deductionCents += p.deductionCents;
    byCategory.set(p.trip.category, cat);

    if (p.trip.category === "business") {
      const period = ratePeriodFor(p.date);
      if (period) {
        const entry = byPeriod.get(period.from) ?? {
          from: period.from,
          to: period.to,
          source: period.source,
          rateTenthsOfCent: period.business,
          miles: 0,
          deductionCents: 0,
        };
        entry.miles += p.miles;
        entry.deductionCents += p.deductionCents;
        byPeriod.set(period.from, entry);
      }
    }
  }

  return {
    year,
    totalTrips: priced.length,
    totalMiles,
    deductibleMiles,
    totalDeductionCents,
    byCategory: [...byCategory.values()].sort((a, b) => b.deductionCents - a.deductionCents),
    businessByPeriod: [...byPeriod.values()].sort((a, b) => a.from.localeCompare(b.from)),
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * IRS-style mileage log.
 *
 * Publication 463 expects a contemporaneous record showing the date, the
 * destination, the business purpose and the mileage. The rate and rate source
 * are included too so the arithmetic can be checked without trusting the app.
 */
export function toCsv(trips: readonly Trip[]): string {
  const header = [
    "Date",
    "Start",
    "End",
    "From",
    "To",
    "Purpose",
    "Category",
    "Miles",
    "Rate",
    "Deduction",
    "Rate source",
  ];

  const rows = [...trips]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((trip) => {
      const p = priceTrip(trip);
      const period = ratePeriodFor(p.date);
      return [
        p.date,
        localTimeOf(trip.startedAt, trip.tzOffsetMinutes),
        localTimeOf(trip.endedAt, trip.tzOffsetMinutes),
        trip.startLabel ?? "",
        trip.endLabel ?? "",
        trip.purpose ?? "",
        trip.category,
        p.miles.toFixed(1),
        trip.category === "personal" ? "" : formatRate(p.rateTenthsOfCent),
        trip.category === "personal" ? "" : (p.deductionCents / 100).toFixed(2),
        trip.category === "personal" ? "" : (period?.source ?? ""),
      ];
    });

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function localTimeOf(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
