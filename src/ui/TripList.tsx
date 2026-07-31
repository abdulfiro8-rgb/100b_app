import { groupByDate } from "../core/classify.js";
import { formatCents, priceTrip } from "../core/report.js";
import type { Trip, TripCategory } from "../core/types.js";

const CATEGORIES: TripCategory[] = ["business", "personal", "medical", "charity"];

const LABELS: Record<TripCategory, string> = {
  business: "Business",
  personal: "Personal",
  medical: "Medical",
  charity: "Charity",
  moving: "Moving",
};

interface Props {
  trips: Trip[];
  onClassify: (id: string, category: TripCategory) => void;
  onPurpose: (id: string, purpose: string) => void;
}

export function TripList({ trips, onClassify, onPurpose }: Props) {
  if (trips.length === 0) {
    return <p className="empty">No trips recorded yet.</p>;
  }

  const days = [...groupByDate(trips).entries()].slice(0, 30);

  return (
    <>
      {days.map(([date, dayTrips]) => (
        <section key={date}>
          <h3 className="day-heading">{formatDayHeading(date)}</h3>
          {dayTrips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              onClassify={onClassify}
              onPurpose={onPurpose}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function TripRow({
  trip,
  onClassify,
  onPurpose,
}: {
  trip: Trip;
  onClassify: (id: string, category: TripCategory) => void;
  onPurpose: (id: string, purpose: string) => void;
}) {
  const priced = priceTrip(trip);
  const deductible = trip.category !== "personal";

  return (
    <article className="trip">
      <div className="trip-top">
        <div>
          <div className="trip-route">
            {trip.startLabel ?? "Trip"} → {trip.endLabel ?? "Destination"}
          </div>
          <div className="trip-meta">
            {formatTime(trip.startedAt, trip.tzOffsetMinutes)} ·{" "}
            {Math.round((trip.endedAt - trip.startedAt) / 60_000)} min
          </div>
        </div>
        <div className="trip-figures">
          <div className="trip-miles">{priced.miles.toFixed(1)} mi</div>
          <div className={`trip-deduction${deductible ? " counted" : ""}`}>
            {deductible ? formatCents(priced.deductionCents) : "—"}
          </div>
        </div>
      </div>

      <div className="segmented" role="group" aria-label="Trip category">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={trip.category === category}
            onClick={() => onClassify(trip.id, category)}
          >
            {LABELS[category]}
          </button>
        ))}
      </div>

      {deductible && (
        <input
          className="purpose-input"
          placeholder="Business purpose (required for the deduction)"
          defaultValue={trip.purpose ?? ""}
          onBlur={(event) => onPurpose(trip.id, event.target.value)}
        />
      )}
    </article>
  );
}

function formatDayHeading(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatTime(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
