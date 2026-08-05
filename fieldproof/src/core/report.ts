import type { IntegrityReport } from "./verify.js";
import type { EvidencePackage } from "./verify.js";
import type { ProvenanceIssue } from "./provenance.js";
import type { EvidenceRecord, Severity } from "./types.js";

/**
 * Derives the report's structure from a package.
 *
 * Kept separate from PDF rendering so the document's shape — what appears, in
 * what order, attributed to which finding — is testable without parsing a PDF.
 */

export interface ReportPhoto {
  evidenceId: string;
  sequence: number;
  caption: string;
  capturedAtLocal: string;
  locationText: string;
  sourceText: string;
  /** Provenance notes attached to this specific photo. */
  notes: ProvenanceIssue[];
}

export interface ReportFinding {
  id: string;
  description: string;
  severity: Severity;
  /** False when no person ever graded this. Shown, not hidden. */
  severityStated: boolean;
  photos: ReportPhoto[];
}

export interface ReportArea {
  area: string;
  findings: ReportFinding[];
}

export interface ReportModel {
  title: string;
  claimNumber: string;
  policyNumber: string;
  insuredName: string;
  propertyAddress: string;
  perilLabel: string;
  inspectorName: string;
  inspectorLicense: string;
  inspectedAtLocal: string;
  areas: ReportArea[];
  /** Photos not attached to any finding — still evidence, still listed. */
  unattached: ReportPhoto[];
  integrity: IntegrityReport;
  photoCount: number;
  /**
   * Findings whose severity nobody confirmed.
   *
   * Printed on the cover so a report cannot present a graded claim as though a
   * person graded it. A silent fallback severity on a document that goes to a
   * carrier is exactly the quiet inaccuracy this app exists to avoid.
   */
  unconfirmedSeverities: number;
}

const PERIL_LABELS: Record<string, string> = {
  wind: "Wind",
  hail: "Hail",
  water: "Water — sudden discharge",
  fire: "Fire",
  flood: "Flood",
  impact: "Impact",
  theft: "Theft",
  other: "Other",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  severe: "Severe",
  total: "Total loss",
};

export function buildReport(pkg: EvidencePackage, integrity: IntegrityReport): ReportModel {
  const { job, records, annotations, findings } = pkg;

  const captions = new Map(annotations.map((a) => [a.evidenceId, a.caption ?? ""]));
  const notesByEvidence = new Map<string, ProvenanceIssue[]>();
  for (const issue of integrity.provenanceIssues) {
    const list = notesByEvidence.get(issue.evidenceId) ?? [];
    list.push(issue);
    notesByEvidence.set(issue.evidenceId, list);
  }

  const byId = new Map(records.map((r) => [r.id, r]));
  const toPhoto = (record: EvidenceRecord): ReportPhoto => ({
    evidenceId: record.id,
    sequence: record.sequence,
    caption: captions.get(record.id) ?? "",
    capturedAtLocal: formatDateTime(record.capturedAt, job.tzOffsetMinutes),
    locationText: record.location
      ? `${record.location.latitude.toFixed(5)}, ${record.location.longitude.toFixed(5)} (±${Math.round(record.location.accuracyMetres)} m)`
      : "No location recorded",
    sourceText: record.source === "camera" ? "Captured in app" : record.source === "library" ? "Imported from library" : "Source not recorded",
    notes: notesByEvidence.get(record.id) ?? [],
  });

  const attached = new Set<string>();
  const areaMap = new Map<string, ReportArea>();

  for (const finding of findings) {
    const photos: ReportPhoto[] = [];
    for (const id of finding.evidenceIds) {
      const record = byId.get(id);
      // A finding referencing evidence that is not in the package is a data
      // error, not something to render as a blank slot.
      if (!record) continue;
      attached.add(id);
      photos.push(toPhoto(record));
    }
    photos.sort((a, b) => a.sequence - b.sequence);

    const area = areaMap.get(finding.area) ?? { area: finding.area, findings: [] };
    area.findings.push({
      id: finding.id,
      description: finding.description,
      severity: finding.severity,
      severityStated: finding.severityStated,
      photos,
    });
    areaMap.set(finding.area, area);
  }

  const unattached = records
    .filter((r) => !attached.has(r.id))
    .sort((a, b) => a.sequence - b.sequence)
    .map(toPhoto);

  return {
    title: `Inspection report — ${job.claimNumber}`,
    claimNumber: job.claimNumber,
    policyNumber: job.policyNumber ?? "—",
    insuredName: job.insuredName,
    propertyAddress: job.propertyAddress,
    perilLabel: PERIL_LABELS[job.peril] ?? job.peril,
    inspectorName: job.inspectorName,
    inspectorLicense: job.inspectorLicense ?? "—",
    inspectedAtLocal: formatDateTime(job.inspectedAt, job.tzOffsetMinutes),
    areas: [...areaMap.values()].sort((a, b) => a.area.localeCompare(b.area)),
    unattached,
    integrity,
    photoCount: records.length,
    unconfirmedSeverities: findings.filter((f) => !f.severityStated).length,
  };
}

export function formatDateTime(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}
