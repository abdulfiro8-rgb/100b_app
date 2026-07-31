import type { TripCategory } from "./types.js";

/**
 * IRS standard mileage rates.
 *
 * Rates are stored as integer **tenths of a cent per mile** so the table holds
 * values like 72.5¢ exactly. Doing this in floating point invites the classic
 * 0.725 * 3 = 2.1749999999999998 problem on a number that ends up on a tax form.
 *
 * Two things make a naive "one rate per year" model wrong:
 *
 *  1. The IRS occasionally raises rates *mid-year* when fuel prices move. It
 *     happened in 2022 and again in 2026. A trip must be priced with the rate in
 *     effect on the date it was driven, so the table is keyed by date range, not
 *     by year.
 *  2. The charitable rate is fixed at 14¢ by statute (26 U.S.C. §170(i)) and is
 *     never inflation-adjusted, so it does not track the business rate.
 *
 * `moving` shares the medical rate and is deductible only for qualified
 * active-duty Armed Forces members.
 */
export interface RatePeriod {
  /** Inclusive local start date, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive local end date, `YYYY-MM-DD`. */
  to: string;
  /** Tenths of a cent per mile. */
  business: number;
  medical: number;
  charity: number;
  /** Human-readable citation, shown in the app so users can verify the number. */
  source: string;
}

export const RATE_PERIODS: readonly RatePeriod[] = [
  {
    from: "2022-01-01",
    to: "2022-06-30",
    business: 585,
    medical: 180,
    charity: 140,
    source: "IRS Notice 2022-03",
  },
  {
    from: "2022-07-01",
    to: "2022-12-31",
    business: 625,
    medical: 220,
    charity: 140,
    source: "IRS Announcement 2022-13 (midyear increase)",
  },
  {
    from: "2023-01-01",
    to: "2023-12-31",
    business: 655,
    medical: 220,
    charity: 140,
    source: "IRS Notice 2023-03",
  },
  {
    from: "2024-01-01",
    to: "2024-12-31",
    business: 670,
    medical: 210,
    charity: 140,
    source: "IRS Notice 2024-08",
  },
  {
    from: "2025-01-01",
    to: "2025-12-31",
    business: 700,
    medical: 210,
    charity: 140,
    source: "IRS Notice 2025-05",
  },
  {
    from: "2026-01-01",
    to: "2026-06-30",
    business: 725,
    medical: 205,
    charity: 140,
    source: "IRS Notice 2026-10",
  },
  {
    from: "2026-07-01",
    to: "2026-12-31",
    business: 760,
    medical: 235,
    charity: 140,
    source: "IRS midyear increase effective 2026-07-01",
  },
];

/**
 * Local calendar date (`YYYY-MM-DD`) for an instant at a given UTC offset.
 *
 * Rate selection is a calendar-date question, not an instant question: a drive
 * finishing at 23:30 on 30 June is a June drive even though it is already July
 * in UTC. Deriving the date from the offset captured at trip start keeps that
 * stable regardless of where the device is when the trip is later reviewed.
 *
 * @param tzOffsetMinutes Minutes ahead of UTC (UTC-5 is -300).
 */
export function localDateOf(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The rate period covering a local date, or `undefined` if the table has no entry. */
export function ratePeriodFor(localDate: string): RatePeriod | undefined {
  // ISO dates compare correctly as strings.
  return RATE_PERIODS.find((p) => localDate >= p.from && localDate <= p.to);
}

/**
 * Rate in tenths of a cent per mile for a category on a date.
 *
 * Returns 0 for `personal` (tracked, never deductible). Throws when the date
 * falls outside the table — silently returning 0 would understate a deduction,
 * which is a worse failure than a visible error.
 */
export function rateFor(category: TripCategory, localDate: string): number {
  if (category === "personal") return 0;

  const period = ratePeriodFor(localDate);
  if (!period) {
    throw new RangeError(
      `No IRS mileage rate on file for ${localDate}. Rates are published annually; ` +
        `update RATE_PERIODS when the IRS releases them.`,
    );
  }

  switch (category) {
    case "business":
      return period.business;
    case "medical":
    case "moving":
      return period.medical;
    case "charity":
      return period.charity;
  }
}

/**
 * Deduction in whole cents for a distance at a given category and date.
 *
 * Rounds half away from zero at the final step only, matching how the figure
 * would be written on a return.
 */
export function deductionCents(miles: number, category: TripCategory, localDate: string): number {
  const tenthsOfCent = rateFor(category, localDate);
  return Math.round((miles * tenthsOfCent) / 10);
}

/** Formats a tenths-of-a-cent rate for display, e.g. 725 -> "72.5¢". */
export function formatRate(tenthsOfCent: number): string {
  return `${(tenthsOfCent / 10).toFixed(1).replace(/\.0$/, "")}¢`;
}
