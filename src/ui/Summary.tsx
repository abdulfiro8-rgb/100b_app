import { formatRate } from "../core/rates.js";
import { formatCents, summariseYear } from "../core/report.js";
import { missingPurpose } from "../core/classify.js";
import type { Trip } from "../core/types.js";

interface Props {
  trips: Trip[];
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
}

export function Summary({ trips, year, years, onYearChange }: Props) {
  const summary = summariseYear(trips, year);
  const needsPurpose = missingPurpose(trips.filter((t) => tripYearOf(t) === year));

  return (
    <>
      {years.length > 1 && (
        <div className="year-picker">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === year}
              onClick={() => onYearChange(y)}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h2>Estimated deduction</h2>
        <p className="sub">{year} tax year</p>
        <p className="headline">{formatCents(summary.totalDeductionCents)}</p>
        <p className="headline-note">
          {summary.deductibleMiles.toFixed(0)} deductible miles of{" "}
          {summary.totalMiles.toFixed(0)} driven · {summary.totalTrips} trips
        </p>
      </section>

      {summary.businessByPeriod.length > 1 && (
        <section className="card">
          <h2>Business miles by IRS rate period</h2>
          <p className="sub">
            The rate changed partway through {year}, so each trip is priced at the rate in
            force on the day it was driven — not one blended rate for the year.
          </p>
          {summary.businessByPeriod.map((period) => (
            <div className="period" key={period.from}>
              <div>
                <div className="period-range">
                  {formatShort(period.from)} – {formatShort(period.to)}
                </div>
                <div className="period-source">{period.source}</div>
              </div>
              <div className="period-figures">
                <div className="period-amount">{formatCents(period.deductionCents)}</div>
                <div className="period-rate">
                  {period.miles.toFixed(0)} mi @ {formatRate(period.rateTenthsOfCent)}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>By category</h2>
        <p className="sub">Personal miles are logged but never deducted.</p>
        {summary.byCategory.length === 0 && <p className="sub">No trips this year.</p>}
        {summary.byCategory.map((cat) => (
          <div className="row" key={cat.category}>
            <span className="row-label">
              <span className={`dot ${cat.category}`} />
              {cat.category[0]!.toUpperCase() + cat.category.slice(1)}
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                {cat.trips} trip{cat.trips === 1 ? "" : "s"}
              </span>
            </span>
            <span>
              {cat.miles.toFixed(0)} mi · <strong>{formatCents(cat.deductionCents)}</strong>
            </span>
          </div>
        ))}
      </section>

      {needsPurpose.length > 0 && (
        <div className="notice">
          <strong>
            {needsPurpose.length} deductible trip{needsPurpose.length === 1 ? "" : "s"} without
            a recorded purpose.
          </strong>{" "}
          IRS Publication 463 expects a business purpose alongside the mileage. Add one on each
          trip before exporting.
        </div>
      )}

      <div className="notice">
        Figures are computed from the published IRS standard mileage rates for your logged
        trips. This is a mileage record, not tax advice.
      </div>
    </>
  );
}

function tripYearOf(trip: Trip): number {
  return new Date(trip.startedAt + trip.tzOffsetMinutes * 60_000).getUTCFullYear();
}

function formatShort(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
