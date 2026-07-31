import { SEVERITY_LABELS } from "../core/report.js";
import type { Finding } from "../core/types.js";

interface Props {
  findings: readonly Finding[];
  selectedEvidenceId: string | null;
  sequenceOf: (evidenceId: string) => number | undefined;
  onAttach: (evidenceId: string, findingId: string) => void;
  onRemove: (id: string) => void;
}

export function FindingsPanel({
  findings,
  selectedEvidenceId,
  sequenceOf,
  onAttach,
  onRemove,
}: Props) {
  if (findings.length === 0) {
    return <p className="empty">No findings yet. Dictate your notes above.</p>;
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
              <span className={`severity ${finding.severity}`}>
                {SEVERITY_LABELS[finding.severity]}
              </span>
            </div>
            <p className="finding-desc">{finding.description}</p>

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
