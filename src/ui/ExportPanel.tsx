import { useMemo } from "react";
import { toCsv } from "../core/report.js";
import type { Trip } from "../core/types.js";

interface Props {
  trips: Trip[];
  year: number;
  onReset: () => void;
}

export function ExportPanel({ trips, year, onReset }: Props) {
  const forYear = useMemo(
    () =>
      trips.filter(
        (t) => new Date(t.startedAt + t.tzOffsetMinutes * 60_000).getUTCFullYear() === year,
      ),
    [trips, year],
  );

  const href = useMemo(() => {
    const blob = new Blob([toCsv(forYear)], { type: "text/csv;charset=utf-8" });
    return URL.createObjectURL(blob);
  }, [forYear]);

  return (
    <>
      <section className="card">
        <h2>Export your {year} log</h2>
        <p className="sub">
          {forYear.length} trips. Each row carries the rate applied and the IRS notice it came
          from, so the arithmetic can be checked without taking this app's word for it.
        </p>
        <a className="button" href={href} download={`mileage-log-${year}.csv`}>
          Download CSV
        </a>
      </section>

      <section className="card">
        <h2>Where your data lives</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          On this device, in local storage. There is no account and no server — a year of your
          movements is not something to hand to someone else's database. The flip side is that
          nothing is backed up for you, so export before switching devices.
        </p>
      </section>

      <section className="card">
        <h2>Demo data</h2>
        <p className="sub">
          This build is seeded with a synthetic year so the reports have something to show.
          Resetting regenerates it.
        </p>
        <button type="button" className="button secondary" onClick={onReset}>
          Reset to fresh demo data
        </button>
      </section>
    </>
  );
}
