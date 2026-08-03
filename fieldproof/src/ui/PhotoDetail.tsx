import type { ProvenanceIssue } from "../core/provenance.js";
import type { EvidenceRecord } from "../core/types.js";

interface Props {
  record: EvidenceRecord;
  caption: string;
  issues: readonly ProvenanceIssue[];
  onCaption: (caption: string) => void;
  tzOffsetMinutes: number;
}

/**
 * Details for the selected photograph, including its caption.
 *
 * Captions are annotations, not evidence: they sit outside the hash chain by
 * design, so writing one up an hour after leaving the property is ordinary work
 * and does not disturb verification.
 */
export function PhotoDetail({ record, caption, issues, onCaption, tzOffsetMinutes }: Props) {
  return (
    <div className="detail">
      <div className="detail-head">
        <strong>Photo {record.sequence + 1}</strong>
        <span className="detail-time">{formatTime(record.capturedAt, tzOffsetMinutes)}</span>
      </div>

      <input
        className="purpose-input"
        placeholder="Caption — what this shows"
        defaultValue={caption}
        key={record.id}
        onBlur={(event) => onCaption(event.target.value)}
      />

      <div className="detail-meta">
        {record.location
          ? `${record.location.latitude.toFixed(5)}, ${record.location.longitude.toFixed(5)} (±${Math.round(record.location.accuracyMetres)} m)`
          : "No location recorded"}
        {" · "}
        {record.source === "camera"
          ? "Captured in app"
          : record.source === "library"
            ? "Imported from library"
            : "Source not recorded"}
      </div>

      {issues.length > 0 && (
        <ul className="badge-notes">
          {issues.map((issue, index) => (
            <li key={index} style={issue.level === "critical" ? { color: "var(--alert)" } : undefined}>
              {issue.detail}
            </li>
          ))}
        </ul>
      )}

      <div className="detail-hash" title="SHA-256 of the image, recorded at capture">
        {record.contentHash.slice(0, 32)}…
      </div>
    </div>
  );
}

function formatTime(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
