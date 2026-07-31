import { describe, expect, it } from "vitest";
import {
  RATE_PERIODS,
  deductionCents,
  formatRate,
  localDateOf,
  rateFor,
  ratePeriodFor,
} from "../src/core/rates.js";

describe("IRS rate table", () => {
  it("covers every date from 2022 through 2026 with no gaps or overlaps", () => {
    const sorted = [...RATE_PERIODS].sort((a, b) => a.from.localeCompare(b.from));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const dayAfterPrev = new Date(`${prev.to}T00:00:00Z`);
      dayAfterPrev.setUTCDate(dayAfterPrev.getUTCDate() + 1);
      expect(next.from).toBe(dayAfterPrev.toISOString().slice(0, 10));
    }
  });

  it("applies the 2026 midyear increase on the correct day", () => {
    // The whole point of a date-ranged table: these two adjacent days differ.
    expect(rateFor("business", "2026-06-30")).toBe(725);
    expect(rateFor("business", "2026-07-01")).toBe(760);

    expect(rateFor("medical", "2026-06-30")).toBe(205);
    expect(rateFor("medical", "2026-07-01")).toBe(235);
  });

  it("also handles the 2022 midyear increase", () => {
    expect(rateFor("business", "2022-06-30")).toBe(585);
    expect(rateFor("business", "2022-07-01")).toBe(625);
  });

  it("keeps the charitable rate fixed at 14 cents, since statute sets it", () => {
    for (const period of RATE_PERIODS) {
      expect(period.charity).toBe(140);
    }
  });

  it("treats moving as sharing the medical rate", () => {
    expect(rateFor("moving", "2026-07-01")).toBe(rateFor("medical", "2026-07-01"));
  });

  it("returns zero for personal miles", () => {
    expect(rateFor("personal", "2026-07-01")).toBe(0);
    expect(deductionCents(1000, "personal", "2026-07-01")).toBe(0);
  });

  it("throws rather than guessing for dates outside the published table", () => {
    // Silently returning 0 would understate a deduction with no visible signal.
    expect(() => rateFor("business", "2030-01-01")).toThrow(RangeError);
    expect(ratePeriodFor("2030-01-01")).toBeUndefined();
  });
});

describe("deduction arithmetic", () => {
  it("computes a whole-cent deduction", () => {
    // 100 miles at 76c
    expect(deductionCents(100, "business", "2026-07-01")).toBe(7600);
  });

  it("handles the fractional-cent rate exactly", () => {
    // 3 miles at 72.5c = 217.5c, which is exactly the value naive float maths
    // turns into 217.49999999999997.
    expect(deductionCents(3, "business", "2026-06-30")).toBe(218);
    expect(deductionCents(4, "business", "2026-06-30")).toBe(290);
  });

  it("formats rates for display", () => {
    expect(formatRate(725)).toBe("72.5¢");
    expect(formatRate(760)).toBe("76¢");
    expect(formatRate(140)).toBe("14¢");
  });
});

describe("local date resolution", () => {
  it("uses the trip's own offset, not the host timezone", () => {
    // 2026-07-01T02:30:00Z is still 30 June at UTC-5.
    const instant = Date.UTC(2026, 6, 1, 2, 30);
    expect(localDateOf(instant, -300)).toBe("2026-06-30");
    expect(localDateOf(instant, 0)).toBe("2026-07-01");
  });

  it("prices a late-night 30 June drive at the first-half rate", () => {
    // The exact boundary the 2026 midyear change created. Getting this wrong
    // silently overstates the deduction by 3.5c per mile.
    const instant = Date.UTC(2026, 6, 1, 3, 30); // 23:30 on 30 June at UTC-4
    const date = localDateOf(instant, -240);
    expect(date).toBe("2026-06-30");
    expect(rateFor("business", date)).toBe(725);
  });
});
