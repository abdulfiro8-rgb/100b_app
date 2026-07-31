import { useState } from "react";
import { useInspection } from "./store/useInspection.js";
import { IntegrityBadge } from "./ui/IntegrityBadge.js";
import { EvidenceGrid } from "./ui/EvidenceGrid.js";
import { FindingsPanel } from "./ui/FindingsPanel.js";

const SAMPLE_DICTATION =
  "Roof north slope. Wind lifted shingles along the ridge, moderate. Also cracked flashing at the chimney. Kitchen: water staining to the ceiling below, minor.";

export function App() {
  const {
    job,
    evidence,
    findings,
    imageFor,
    integrity,
    busy,
    addPhoto,
    dictate,
    attach,
    removeFinding,
    downloadReport,
  } = useInspection();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState(SAMPLE_DICTATION);

  const sequenceOf = (id: string) => evidence.find((e) => e.id === id)?.sequence;

  return (
    <div className="app">
      <header className="header">
        <div className="eyebrow">Claim {job.claimNumber}</div>
        <h1>{job.insuredName}</h1>
        <p className="address">{job.propertyAddress}</p>
      </header>

      <IntegrityBadge report={integrity} />

      <section className="card">
        <h2>Evidence</h2>
        <p className="sub">
          Each photograph is hashed and linked to the one before it as it is taken. Tap one to
          attach it to a finding.
        </p>

        <EvidenceGrid
          evidence={evidence}
          imageFor={imageFor}
          issues={integrity?.provenanceIssues ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
          tzOffsetMinutes={job.tzOffsetMinutes}
        />

        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="button" disabled={busy} onClick={() => addPhoto("camera")}>
            Take photo
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => addPhoto("library")}
          >
            Import
          </button>
        </div>
        <p className="hint">
          Imported images are recorded as imported — the app cannot vouch for where they came
          from.
        </p>
      </section>

      <section className="card">
        <h2>Dictate findings</h2>
        <p className="sub">
          Say the area once, then keep talking. Parsed on device — no network, no API key.
        </p>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Roof. Lifted shingles along the ridge, moderate…"
        />
        <button
          type="button"
          className="button"
          onClick={async () => {
            await dictate(notes);
            setNotes("");
          }}
          disabled={!notes.trim()}
        >
          Add findings
        </button>
      </section>

      <section className="card">
        <h2>Findings</h2>
        <p className="sub">
          {selectedId
            ? `Photo ${(sequenceOf(selectedId) ?? 0) + 1} selected — attach it below.`
            : "Select a photograph to attach it to a finding."}
        </p>
        <FindingsPanel
          findings={findings}
          selectedEvidenceId={selectedId}
          sequenceOf={sequenceOf}
          onAttach={attach}
          onRemove={removeFinding}
        />
      </section>

      <section className="card">
        <h2>Report</h2>
        <p className="sub">
          Generates the PDF with photographs, findings and an integrity appendix stating what the
          check does and does not establish.
        </p>
        <button
          type="button"
          className="button"
          onClick={downloadReport}
          disabled={evidence.length === 0}
        >
          Generate report PDF
        </button>
      </section>
    </div>
  );
}
