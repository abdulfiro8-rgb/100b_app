import { useEffect, useMemo, useState } from "react";
import type { ProvenanceIssue } from "../core/provenance.js";
import type { EvidenceRecord } from "../core/types.js";

interface Props {
  evidence: readonly EvidenceRecord[];
  imageFor: (id: string) => Uint8Array | undefined;
  issues: readonly ProvenanceIssue[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tzOffsetMinutes: number;
}

export function EvidenceGrid({
  evidence,
  imageFor,
  issues,
  selectedId,
  onSelect,
  tzOffsetMinutes,
}: Props) {
  const urls = useObjectUrls(evidence, imageFor);

  const issuesById = useMemo(() => {
    const map = new Map<string, ProvenanceIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.evidenceId) ?? [];
      list.push(issue);
      map.set(issue.evidenceId, list);
    }
    return map;
  }, [issues]);

  if (evidence.length === 0) {
    return <p className="empty">No photographs yet. Capture one to start the chain.</p>;
  }

  return (
    <div className="grid">
      {evidence.map((record) => {
        const recordIssues = issuesById.get(record.id) ?? [];
        const worst = recordIssues.find((i) => i.level === "critical") ?? recordIssues[0];

        return (
          <button
            type="button"
            key={record.id}
            className={`shot${selectedId === record.id ? " selected" : ""}`}
            onClick={() => onSelect(selectedId === record.id ? null : record.id)}
          >
            <img src={urls.get(record.id)} alt={`Photograph ${record.sequence + 1}`} />
            <div className="shot-meta">
              <div className="shot-seq">Photo {record.sequence + 1}</div>
              <div>{formatTime(record.capturedAt, tzOffsetMinutes)}</div>
              {worst && (
                <span className={`flag${worst.level === "critical" ? " critical" : ""}`}>
                  {shortLabel(worst.code)}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Creates blob URLs for the captured bytes and revokes them on unmount. */
function useObjectUrls(
  evidence: readonly EvidenceRecord[],
  imageFor: (id: string) => Uint8Array | undefined,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const created = new Map<string, string>();
    for (const record of evidence) {
      const bytes = imageFor(record.id);
      if (!bytes) continue;
      created.set(
        record.id,
        URL.createObjectURL(new Blob([bytes as BlobPart], { type: record.mimeType })),
      );
    }
    setUrls(created);

    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence]);

  return urls;
}

function shortLabel(code: ProvenanceIssue["code"]): string {
  switch (code) {
    case "far-from-property":
      return "off site";
    case "no-location":
      return "no GPS";
    case "poor-accuracy":
      return "weak GPS";
    case "clock-moved-backwards":
    case "clock-inconsistent":
      return "clock";
    case "library-import":
      return "imported";
    case "unknown-source":
      return "source?";
    case "outside-inspection-window":
      return "off date";
    case "exif-mismatch":
      return "metadata";
  }
}

function formatTime(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
