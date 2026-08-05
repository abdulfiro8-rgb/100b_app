import { appendRecord, sha256Hex } from "./chain.js";
import { buildReport } from "./report.js";
import { verifyPackage, type EvidencePackage, type IntegrityReport } from "./verify.js";
import { buildContext, type CaptureDeps } from "../capture/types.js";
import type { EvidenceAnnotation, EvidenceRecord, Finding, Job } from "./types.js";

/**
 * One inspection in progress.
 *
 * Owns the append-only evidence chain and the editable annotations beside it.
 * Photographs can only be added, never removed or reordered through this API —
 * a "delete photo" button would produce exactly the gap the chain is designed
 * to expose, so evidence that turns out to be irrelevant is left in place and
 * simply not attached to a finding.
 */
export class InspectionSession {
  private records: EvidenceRecord[] = [];
  private readonly images = new Map<string, Uint8Array>();
  private annotations: EvidenceAnnotation[] = [];
  private findings: Finding[] = [];

  constructor(
    readonly job: Job,
    private readonly deps: CaptureDeps,
  ) {}

  /**
   * Restores a session from storage.
   *
   * Records are adopted exactly as supplied. Hashes are deliberately **not**
   * recomputed: if storage corrupted, dropped or reordered a record, that must
   * surface as a verification failure. Recalculating on load would repair the
   * evidence of damage and return a package that looks pristine — the one
   * outcome this product cannot afford.
   */
  static hydrate(
    job: Job,
    deps: CaptureDeps,
    stored: {
      records: readonly EvidenceRecord[];
      images: ReadonlyMap<string, Uint8Array>;
      annotations: readonly EvidenceAnnotation[];
      findings: readonly Finding[];
    },
  ): InspectionSession {
    const session = new InspectionSession(job, deps);
    session.records = [...stored.records];
    session.annotations = [...stored.annotations];
    // Findings written before severity confirmation existed are treated as
    // confirmed. Defaulting the other way would retroactively accuse every
    // historic finding of being ungraded.
    session.findings = stored.findings.map((f) => ({
      ...f,
      severityStated: f.severityStated ?? true,
    }));
    for (const [id, bytes] of stored.images) session.images.set(id, bytes);
    return session;
  }

  get evidence(): readonly EvidenceRecord[] {
    return this.records;
  }

  get files(): ReadonlyMap<string, Uint8Array> {
    return this.images;
  }

  get notes(): readonly EvidenceAnnotation[] {
    return this.annotations;
  }

  get observations(): readonly Finding[] {
    return this.findings;
  }

  imageFor(evidenceId: string): Uint8Array | undefined {
    return this.images.get(evidenceId);
  }

  async addPhoto(kind: "camera" | "library" = "camera"): Promise<EvidenceRecord> {
    const captured =
      kind === "camera"
        ? await this.deps.camera.capture()
        : await this.deps.camera.pickFromLibrary();

    // The context is assembled after the image exists so the timestamp reflects
    // the capture, not the moment the shutter UI opened.
    const context = await buildContext(this.deps, captured.source);

    const record = await appendRecord(this.records, {
      id: `${this.job.id}-ev-${this.records.length}`,
      jobId: this.job.id,
      contentHash: await sha256Hex(captured.bytes),
      byteLength: captured.bytes.byteLength,
      mimeType: captured.mimeType,
      context,
    });

    this.records = [...this.records, record];
    this.images.set(record.id, captured.bytes);
    return record;
  }

  setCaption(evidenceId: string, caption: string): void {
    const existing = this.annotations.find((a) => a.evidenceId === evidenceId);
    this.annotations = existing
      ? this.annotations.map((a) => (a.evidenceId === evidenceId ? { ...a, caption } : a))
      : [...this.annotations, { evidenceId, caption }];
  }

  addFinding(finding: Omit<Finding, "id">): Finding {
    const created: Finding = { ...finding, id: `${this.job.id}-f-${this.findings.length}` };
    this.findings = [...this.findings, created];
    return created;
  }

  updateFinding(id: string, patch: Partial<Omit<Finding, "id">>): void {
    this.findings = this.findings.map((f) => (f.id === id ? { ...f, ...patch } : f));
  }

  removeFinding(id: string): void {
    // Findings are interpretation, not evidence, so withdrawing one is normal.
    this.findings = this.findings.filter((f) => f.id !== id);
  }

  attach(evidenceId: string, findingId: string): void {
    this.findings = this.findings.map((f) =>
      f.id === findingId && !f.evidenceIds.includes(evidenceId)
        ? { ...f, evidenceIds: [...f.evidenceIds, evidenceId] }
        : f,
    );
  }

  detach(evidenceId: string, findingId: string): void {
    this.findings = this.findings.map((f) =>
      f.id === findingId
        ? { ...f, evidenceIds: f.evidenceIds.filter((id) => id !== evidenceId) }
        : f,
    );
  }

  toPackage(): EvidencePackage {
    return {
      job: this.job,
      records: [...this.records],
      annotations: [...this.annotations],
      findings: [...this.findings],
    };
  }

  verify(): Promise<IntegrityReport> {
    return verifyPackage(this.toPackage(), this.images);
  }

  async renderPdf(): Promise<Uint8Array> {
    // Loaded on demand: pdf-lib is by far the heaviest dependency and is only
    // needed when a report is actually generated, which is once per inspection
    // rather than on launch. Keeping it out of the initial bundle matters on a
    // phone on site with poor signal.
    const { renderReportPdf } = await import("./pdf.js");
    const integrity = await this.verify();
    return renderReportPdf(buildReport(this.toPackage(), integrity), this.images);
  }
}
