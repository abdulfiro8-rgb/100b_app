import { milesToMetres } from "../core/geo.js";
import type { Trip, TripCategory } from "../core/types.js";

/**
 * A plausible year of driving, deliberately straddling 2026's midyear rate
 * change so the split is visible in the summary rather than theoretical.
 *
 * Used to populate the app in a browser, where there is no GPS to record from.
 */

const HOME = { latitude: 37.7749, longitude: -122.4194 };
const TZ = -420; // UTC-7

interface Route {
  from: string;
  to: string;
  miles: number;
  category: TripCategory;
  purpose?: string;
  /** Relative likelihood. Personal driving dominates a real log. */
  weight: number;
}

/**
 * Weighted so business use lands near 40% of miles. A seed where almost every
 * trip is deductible would demo well and describe nobody: the IRS expects a
 * business-use percentage, and a log claiming 95% invites exactly the scrutiny
 * this app is meant to survive.
 */
const ROUTES: Route[] = [
  {
    from: "Home",
    to: "Client — Peninsula",
    miles: 24.6,
    category: "business",
    purpose: "On-site consulting",
    weight: 8,
  },
  {
    from: "Home",
    to: "Supplier warehouse",
    miles: 11.2,
    category: "business",
    purpose: "Materials collection",
    weight: 6,
  },
  {
    from: "Home",
    to: "SFO",
    miles: 18.4,
    category: "business",
    purpose: "Conference travel",
    weight: 2,
  },
  { from: "Home", to: "Grocery", miles: 4.1, category: "personal", weight: 18 },
  { from: "Home", to: "School run", miles: 3.4, category: "personal", weight: 14 },
  { from: "Home", to: "Gym", miles: 5.2, category: "personal", weight: 10 },
  { from: "Home", to: "Weekend trip", miles: 31.5, category: "personal", weight: 4 },
  {
    from: "Home",
    to: "Medical centre",
    miles: 9.8,
    category: "medical",
    purpose: "Physiotherapy",
    weight: 3,
  },
  {
    from: "Home",
    to: "Food bank",
    miles: 6.3,
    category: "charity",
    purpose: "Volunteer delivery",
    weight: 3,
  },
];

const TOTAL_WEIGHT = ROUTES.reduce((sum, r) => sum + r.weight, 0);

function pickRoute(roll: number): Route {
  let cursor = roll * TOTAL_WEIGHT;
  for (const route of ROUTES) {
    cursor -= route.weight;
    if (cursor <= 0) return route;
  }
  return ROUTES[ROUTES.length - 1]!;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** Trips spread across the year, weighted towards weekdays. */
export function seedTrips(year = 2026, upToMonth = 11): Trip[] {
  const rand = seededRandom(20260715);
  const trips: Trip[] = [];

  for (let month = 0; month <= upToMonth; month++) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const tripsToday = isWeekend ? (rand() < 0.4 ? 1 : 0) : rand() < 0.75 ? 2 : 1;

      for (let n = 0; n < tripsToday; n++) {
        const route = pickRoute(rand());
        const hour = 7 + Math.floor(rand() * 11);
        const minute = Math.floor(rand() * 60);

        // Local wall-clock time converted to an instant at UTC-7.
        const startedAt =
          Date.UTC(year, month, day, hour, minute) - TZ * 60_000;
        const miles = route.miles * (0.9 + rand() * 0.2);
        const durationMs = Math.round((miles / 28) * 60 * 60_000); // ~28 mph average

        trips.push({
          id: `seed-${year}-${month}-${day}-${n}`,
          startedAt,
          endedAt: startedAt + durationMs,
          tzOffsetMinutes: TZ,
          distanceMetres: milesToMetres(miles),
          category: route.category,
          purpose: route.purpose,
          startLabel: route.from,
          endLabel: route.to,
          path: [
            { timestamp: startedAt, ...HOME, accuracy: 8 },
            { timestamp: startedAt + durationMs, ...HOME, accuracy: 8 },
          ],
        });
      }
    }
  }

  return trips.sort((a, b) => b.startedAt - a.startedAt);
}
