import { describe, expect, it } from "vitest";
import { milesToMetres } from "../src/core/geo.js";
import { summariseYear, toCsv, priceTrip } from "../src/core/report.js";
import type { Trip, TripCategory } from "../src/core/types.js";

/** A trip of an exact mileage on an exact local date. */
function tripOn(date: string, miles: number, category: TripCategory = "business"): Trip {
  const startedAt = Date.parse(`${date}T14:00:00Z`) + 7 * 60 * 60_000; // 14:00 at UTC-7
  return {
    id: `t-${date}-${miles}`,
    startedAt,
    endedAt: startedAt + 30 * 60_000,
    tzOffsetMinutes: -420,
    distanceMetres: milesToMetres(miles),
    category,
    purpose: "Client visit",
    path: [],
  };
}

describe("year-end summary across a midyear rate change", () => {
  // 2026 is the case that breaks naive implementations: 72.5c through 30 June,
  // 76c from 1 July.
  const trips = [
    tripOn("2026-03-10", 100),
    tripOn("2026-06-30", 100),
    tripOn("2026-07-01", 100),
    tripOn("2026-11-20", 100),
  ];

  it("prices each trip at the rate in effect on its own date", () => {
    const priced = trips.map(priceTrip);
    expect(priced.map((p) => p.rateTenthsOfCent)).toEqual([725, 725, 760, 760]);
    expect(priced.map((p) => p.deductionCents)).toEqual([7250, 7250, 7600, 7600]);
  });

  it("does not compute the total as miles x a single annual rate", () => {
    const summary = summariseYear(trips, 2026);

    // Correct: 200 mi at 72.5c + 200 mi at 76c.
    expect(summary.totalDeductionCents).toBe(7250 + 7250 + 7600 + 7600);
    expect(summary.totalDeductionCents).toBe(29_700);

    // The two shortcuts a naive implementation takes, both wrong by real money.
    const allAtOldRate = Math.round(400 * 72.5);
    const allAtNewRate = Math.round(400 * 76);
    expect(summary.totalDeductionCents).not.toBe(allAtOldRate);
    expect(summary.totalDeductionCents).not.toBe(allAtNewRate);
    expect(allAtNewRate - summary.totalDeductionCents).toBe(700); // $7 overstated
  });

  it("breaks business mileage down by rate period so the split is visible", () => {
    const summary = summariseYear(trips, 2026);

    expect(summary.businessByPeriod).toHaveLength(2);
    expect(summary.businessByPeriod[0]).toMatchObject({
      from: "2026-01-01",
      to: "2026-06-30",
      rateTenthsOfCent: 725,
      deductionCents: 14_500,
    });
    expect(summary.businessByPeriod[1]).toMatchObject({
      from: "2026-07-01",
      to: "2026-12-31",
      rateTenthsOfCent: 760,
      deductionCents: 15_200,
    });
    expect(summary.businessByPeriod[0]!.miles).toBeCloseTo(200, 6);
  });

  it("equals the sum of its per-trip deductions exactly", () => {
    const summary = summariseYear(trips, 2026);
    const perTrip = trips.map(priceTrip).reduce((sum, p) => sum + p.deductionCents, 0);
    expect(summary.totalDeductionCents).toBe(perTrip);
  });
});

describe("categories", () => {
  const trips = [
    tripOn("2026-07-10", 100, "business"),
    tripOn("2026-07-11", 50, "medical"),
    tripOn("2026-07-12", 40, "charity"),
    tripOn("2026-07-13", 200, "personal"),
  ];

  it("applies the right rate to each category", () => {
    const summary = summariseYear(trips, 2026);
    const find = (c: TripCategory) => summary.byCategory.find((x) => x.category === c);

    expect(find("business")!.deductionCents).toBe(7600); // 100 @ 76c
    expect(find("medical")!.deductionCents).toBe(1175); // 50 @ 23.5c
    expect(find("charity")!.deductionCents).toBe(560); // 40 @ 14c
    expect(find("personal")!.deductionCents).toBe(0);
  });

  it("counts personal miles in the total but not the deductible total", () => {
    const summary = summariseYear(trips, 2026);
    expect(summary.totalMiles).toBeCloseTo(390, 6);
    expect(summary.deductibleMiles).toBeCloseTo(190, 6);
  });

  it("excludes trips from other years", () => {
    const summary = summariseYear([...trips, tripOn("2025-07-10", 999)], 2026);
    expect(summary.totalTrips).toBe(4);
  });
});

describe("CSV log", () => {
  it("records rate and source per row so the arithmetic can be checked", () => {
    const csv = toCsv([tripOn("2026-06-30", 100), tripOn("2026-07-01", 100)]);
    const lines = csv.split("\n");

    expect(lines[0]).toContain("Rate source");
    expect(lines[1]).toContain("72.5¢");
    expect(lines[1]).toContain("72.50");
    expect(lines[2]).toContain("76¢");
    expect(lines[2]).toContain("76.00");
  });

  it("leaves rate columns blank for personal trips", () => {
    const csv = toCsv([tripOn("2026-07-01", 100, "personal")]);
    const row = csv.split("\n")[1]!;
    expect(row).toContain("personal");
    expect(row).not.toContain("76¢");
  });

  it("escapes commas and quotes in free text", () => {
    const trip = { ...tripOn("2026-07-01", 10), purpose: 'Client "A", site visit' };
    const row = toCsv([trip]).split("\n")[1]!;
    expect(row).toContain('"Client ""A"", site visit"');
  });
});
