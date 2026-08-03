import { useState } from "react";
import { useApp } from "./store/useApp.js";
import { IntegrityBadge } from "./ui/IntegrityBadge.js";
import { EvidenceGrid } from "./ui/EvidenceGrid.js";
import { FindingsPanel } from "./ui/FindingsPanel.js";
import { DictatePanel } from "./ui/DictatePanel.js";
import { PhotoDetail } from "./ui/PhotoDetail.js";
import { JobList } from "./ui/JobList.js";
import { VerifyScreen } from "./ui/VerifyScreen.js";

type Tab = "jobs" | "verify";

export function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("jobs");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sequenceOf = (id: string) => app.evidence.find((e) => e.id === id)?.sequence;
  const selected = selectedId ? app.evidence.find((e) => e.id === selectedId) : undefined;

  if (app.loading) {
    return (
      <div className="app">
        <p className="empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="eyebrow">Fieldproof</div>
        <h1>{app.activeJob ? app.activeJob.claimNumber : "Inspections"}</h1>
        <p className="address">
          {app.activeJob ? app.activeJob.propertyAddress : "Evidence you can hand over"}
        </p>
      </header>

      {!app.activeJob && (
        <nav className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={tab === "jobs"}
            onClick={() => setTab("jobs")}
          >
            Inspections
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={tab === "verify"}
            onClick={() => setTab("verify")}
          >
            Verify a package
          </button>
        </nav>
      )}

      {!app.activeJob && tab === "jobs" && (
        <JobList
          jobs={app.jobs}
          onOpen={app.setActiveJobId}
          onCreate={app.createJob}
          onDelete={app.deleteJob}
        />
      )}

      {!app.activeJob && tab === "verify" && <VerifyScreen />}

      {app.activeJob && (
        <>
          <button
            type="button"
            className="link"
            style={{ margin: "0 4px 12px" }}
            onClick={() => {
              app.setActiveJobId(null);
              setSelectedId(null);
            }}
          >
            ← All inspections
          </button>

          <IntegrityBadge report={app.integrity} />

          <section className="card">
            <h2>Evidence</h2>
            <p className="sub">
              Each photograph is hashed and linked to the one before it as it is taken, and saved
              immediately. Tap one to attach it to a finding.
            </p>

            <EvidenceGrid
              evidence={app.evidence}
              imageFor={app.imageFor}
              issues={app.integrity?.provenanceIssues ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
              tzOffsetMinutes={app.activeJob.tzOffsetMinutes}
            />

            {selected && (
              <PhotoDetail
                record={selected}
                caption={app.captions.get(selected.id) ?? ""}
                issues={(app.integrity?.provenanceIssues ?? []).filter(
                  (i) => i.evidenceId === selected.id,
                )}
                onCaption={(caption) => void app.setCaption(selected.id, caption)}
                tzOffsetMinutes={app.activeJob.tzOffsetMinutes}
              />
            )}

            <div className="actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="button"
                disabled={app.busy}
                onClick={() => app.addPhoto("camera")}
              >
                Take photo
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={app.busy}
                onClick={() => app.addPhoto("library")}
              >
                Import
              </button>
            </div>
            <p className="hint">
              Imported images are recorded as imported — the app cannot vouch for where they came
              from.
            </p>
          </section>

          <DictatePanel controller={app.dictation} onFindings={app.dictate} />

          <section className="card">
            <h2>Recorded findings</h2>
            <p className="sub">
              {selectedId
                ? `Photo ${(sequenceOf(selectedId) ?? 0) + 1} selected — attach it below.`
                : "Select a photograph to attach it to a finding."}
            </p>
            <FindingsPanel
              findings={app.findings}
              selectedEvidenceId={selectedId}
              sequenceOf={sequenceOf}
              onAttach={app.attach}
              onRemove={app.removeFinding}
            />
          </section>

          <section className="card">
            <h2>Hand it over</h2>
            <p className="sub">
              The PDF is the report. The package is the evidence behind it — any examiner can open
              it and check the hashes without this app.
            </p>
            <button
              type="button"
              className="button"
              onClick={app.downloadReport}
              disabled={app.evidence.length === 0}
            >
              Generate report PDF
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={app.exportPackage}
              disabled={app.evidence.length === 0}
            >
              Export evidence package (.fpx)
            </button>
          </section>
        </>
      )}
    </div>
  );
}
