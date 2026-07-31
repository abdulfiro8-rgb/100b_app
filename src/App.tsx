import { useState } from "react";
import { useTrips } from "./store/useTrips.js";
import { TripList } from "./ui/TripList.js";
import { Summary } from "./ui/Summary.js";
import { ExportPanel } from "./ui/ExportPanel.js";

type Tab = "trips" | "summary" | "export";

export function App() {
  const { trips, years, classify, setPurpose, reset } = useTrips();
  const [tab, setTab] = useState<Tab>("summary");
  const [year, setYear] = useState(() => years[0] ?? new Date().getUTCFullYear());

  return (
    <div className="app">
      <header className="header">
        <h1>Milestamp</h1>
        <p>Automatic mileage. On your device, on the right rate.</p>
      </header>

      <nav className="tabs" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "summary"}
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "trips"}
          onClick={() => setTab("trips")}
        >
          Trips
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "export"}
          onClick={() => setTab("export")}
        >
          Export
        </button>
      </nav>

      <main>
        {tab === "summary" && (
          <Summary trips={trips} year={year} years={years} onYearChange={setYear} />
        )}
        {tab === "trips" && (
          <TripList trips={trips} onClassify={classify} onPurpose={setPurpose} />
        )}
        {tab === "export" && <ExportPanel trips={trips} year={year} onReset={reset} />}
      </main>
    </div>
  );
}
