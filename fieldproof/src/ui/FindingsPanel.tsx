import { SEVERITY_LABELS } from "../core/report.js";
import type { Finding, Severity } from "../core/types.js";

const SEVERITIES: Severity[] = ["minor", "moderate", "severe", "total"];

interface Props {
  findings: readonly Finding[];
  selectedEvidenceId: string | null;
  sequenceOf: (evidenceId: string) => number | undefined;
  onAttach: (evidenceId: string, findingId: string) => void;
  onUpdate: (id: string, patch: { description?: string; severity?: Severity }) => void;
  onRemove: (id: string) => void;
}

export function FindingsPanel({
  findings,
  selectedEvidenceId,
  sequenceOf,
  onAttach,
  onUpdate,
  onRemove,
}: Props) {
  if (findings.length === 0) {
    return <p className="empty">No findings yet. Dictate or type your notes above.</p>;
  }

  return (
    <>
      {findings.map((finding) => {
        const attached = selectedEvidenceId
          ? finding.evidenceIds.includes(selectedEvidenceId)
          : false;

        return (
          <div className="finding" key={finding.id}>
            <div className="finding-top">
              <span className="finding-area">{finding.area}</span>
              {!finding.severityStated && (
                <span className="unconfirmed">severity not stated</span>
              )}
            </div>

            <textarea
              className="finding-edit"
              defaultValue={finding.description}
              rows={2}
              onBlur={(event) => {
                const description = event.target.value.trim();
                if (description && description !== finding.description) {
                  onUpdate(finding.id, { description });
                }
              }}
            />

            {/* The dictation never graded this, so the app asks rather than
                filing a number nobody chose. */}
            {!finding.severityStated && (
              <p className="hint" style={{ margin: "0 0 6px" }}>
                You did not say how bad this is. Choose a severity to confirm it.
              </p>
            )}

            <div className="segmented" role="group" aria-label="Severity">
              {SEVERITIES.map((severity) => (
                <button
                  key={severity}
                  type="button"
                  aria-pressed={finding.severityStated && finding.severity === severity}
                  onClick={() => onUpdate(finding.id, { severity })}
                >
                  {SEVERITY_LABELS[severity]}
                </button>
              ))}
            </div>

            <div className="finding-photos">
              {finding.evidenceIds.length > 0
                ? `Photos ${finding.evidenceIds
                    .map((id) => {
                      const seq = sequenceOf(id);
                      return seq === undefined ? "?" : seq + 1;
                    })
                    .join(", ")}`
                : "No photographs attached"}
            </div>

            <div style={{ marginTop: 7, display: "flex", gap: 12 }}>
              {selectedEvidenceId && (
                <button
                  type="button"
                  className="link"
                  onClick={() => onAttach(selectedEvidenceId, finding.id)}
                >
                  {attached ? "Detach selected photo" : "Attach selected photo"}
                </button>
              )}
              <button type="button" className="link danger" onClick={() => onRemove(finding.id)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
