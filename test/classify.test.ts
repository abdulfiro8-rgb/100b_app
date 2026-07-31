import { describe, expect, it } from "vitest";
import { applyRules, missingPurpose, ruleMatches, type Rule } from "../src/core/classify.js";
import { milesToMetres } from "../src/core/geo.js";
import type { Trip } from "../src/core/types.js";
import { offsetMetres } from "./support/traces.js";

const HOME = { latitude: 37.7749, longitude: -122.4194 };
const OFFICE = offsetMetres(HOME.latitude, HOME.longitude, 12_000, 0);

/** @param localHour hour of day at UTC-7 */
function commute(localDate: string, localHour: number): Trip {
  const startedAt = Date.parse(`${localDate}T00:00:00Z`) + (localHour + 7) * 60 * 60_000;
  return {
    id: `c-${localDate}-${localHour}`,
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    tzOffsetMinutes: -420,
    distanceMetres: milesToMetres(7.5),
    category: "personal",
    path: [
      { timestamp: startedAt, ...HOME, accuracy: 8 },
      { timestamp: startedAt + 25 * 60_000, ...OFFICE, accuracy: 8 },
    ],
  };
}

const toOffice: Rule = {
  id: "r1",
  name: "Commute to office",
  category: "business",
  purpose: "Travel to client site",
  startsNear: { ...HOME, radiusMetres: 200 },
  endsNear: { ...OFFICE, radiusMetres: 200 },
  daysOfWeek: [1, 2, 3, 4, 5],
  fromTime: "06:00",
  toTime: "10:00",
};

describe("auto-classification rules", () => {
  it("matches a weekday morning commute", () => {
    // 2026-07-15 is a Wednesday.
    expect(ruleMatches(toOffice, commute("2026-07-15", 8))).toBe(true);
  });

  it("does not match at the weekend", () => {
    // 2026-07-18 is a Saturday.
    expect(ruleMatches(toOffice, commute("2026-07-18", 8))).toBe(false);
  });

  it("does not match outside the time window", () => {
    expect(ruleMatches(toOffice, commute("2026-07-15", 20))).toBe(false);
  });

  it("does not match a trip that starts somewhere else", () => {
    const elsewhere = commute("2026-07-15", 8);
    const far = offsetMetres(HOME.latitude, HOME.longitude, 5000, 5000);
    elsewhere.path[0] = { timestamp: elsewhere.startedAt, ...far, accuracy: 8 };
    expect(ruleMatches(toOffice, elsewhere)).toBe(false);
  });

  it("uses the trip's own timezone offset, not the host's", () => {
    const trip = commute("2026-07-15", 8);
    // Same instant, but recorded as if the device were on UTC: 15:00 local,
    // outside the morning window.
    expect(ruleMatches(toOffice, { ...trip, tzOffsetMinutes: 0 })).toBe(false);
  });

  it("never fires a rule with no conditions", () => {
    // A rule that matched everything would silently reclassify a whole year.
    const empty: Rule = { id: "r0", name: "Empty", category: "business" };
    expect(ruleMatches(empty, commute("2026-07-15", 8))).toBe(false);
  });
});

describe("applying rules", () => {
  it("sets category and purpose from the matching rule", () => {
    const result = applyRules(commute("2026-07-15", 8), [toOffice]);
    expect(result.category).toBe("business");
    expect(result.purpose).toBe("Travel to client site");
  });

  it("leaves a manually classified trip alone", () => {
    const manual = { ...commute("2026-07-15", 8), category: "personal" as const };
    const result = applyRules(manual, [toOffice], true);
    expect(result.category).toBe("personal");
  });

  it("leaves the trip untouched when nothing matches", () => {
    const trip = commute("2026-07-18", 8);
    expect(applyRules(trip, [toOffice])).toEqual(trip);
  });
});

describe("audit readiness", () => {
  it("flags deductible trips with no written purpose", () => {
    const trips: Trip[] = [
      { ...commute("2026-07-15", 8), category: "business", purpose: "Client visit" },
      { ...commute("2026-07-16", 8), category: "business", purpose: "  " },
      { ...commute("2026-07-17", 8), category: "business" },
      { ...commute("2026-07-18", 8), category: "personal" },
    ];

    // Pub. 463 wants a purpose recorded; personal trips need none.
    expect(missingPurpose(trips).map((t) => t.id)).toEqual([
      "c-2026-07-16-8",
      "c-2026-07-17-8",
    ]);
  });
});
