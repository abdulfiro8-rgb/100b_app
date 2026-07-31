import { summariseIntegrity, type IntegrityReport } from "../core/verify.js";

/**
 * The claim the product is selling, stated on screen.
 *
 * Wording is deliberately bounded: "verified" refers to the files matching
 * their capture records, never to the photographs being proof of anything about
 * the property. The appendix in the PDF carries the same limits.
 */
export function IntegrityBadge({ report }: { report: IntegrityReport | null }) {
  if (!report) {
    return (
      <div className="badge warn">
        <span className="badge-mark">•</span>
        <div>
          <div className="badge-title">Checking evidence…</div>
        </div>
      </div>
    );
  }

  if (report.recordCount === 0) {
    return (
      <div className="badge warn">
        <span className="badge-mark">○</span>
        <div>
          <div className="badge-title">No evidence captured yet</div>
          <div className="badge-detail">
            Photographs are hashed and chained as they are taken.
          </div>
        </div>
      </div>
    );
  }

  const broken = report.integrity === "broken";
  const questions = report.provenanceIssues.length > 0;
  const tone = broken ? "bad" : questions ? "warn" : "ok";

  const notes = [
    ...report.chainIssues.map((i) => i.detail),
    ...report.contentIssues.map((i) => i.detail),
    ...report.provenanceIssues.map((i) => i.detail),
  ].slice(0, 4);

  return (
    <div className={`badge ${tone}`}>
      <span className="badge-mark">{broken ? "✕" : questions ? "!" : "✓"}</span>
      <div>
        <div className="badge-title">
          {broken
            ? "Chain of custody broken"
            : questions
              ? "Intact, with provenance notes"
              : "Chain of custody intact"}
        </div>
        <div className="badge-detail">{summariseIntegrity(report)}</div>
        {notes.length > 0 && (
          <ul className="badge-notes">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
