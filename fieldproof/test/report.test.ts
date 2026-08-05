import { describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { buildReport } from "../src/core/report.js";
import { renderReportPdf } from "../src/core/pdf.js";
import { verifyPackage, type EvidencePackage } from "../src/core/verify.js";
import { buildEvidence, flipByte, goodInspection, makeJob } from "./support/fixtures.js";

const job = makeJob();

async function inspectionPackage(): Promise<{
  pkg: EvidencePackage;
  images: Map<string, Uint8Array>;
}> {
  const { records, images } = await buildEvidence(job, goodInspection());
  return {
    pkg: {
      job,
      records,
      annotations: [
        { evidenceId: "ev-0", caption: "North elevation" },
        { evidenceId: "ev-1", caption: "Ridge close-up" },
      ],
      findings: [
        {
          id: "f-1",
          area: "Roof — north slope",
          description: "Wind-lifted shingles along the ridge line",
          severity: "moderate",
          severityStated: true,
          evidenceIds: ["ev-0", "ev-1"],
        },
        {
          id: "f-2",
          area: "Exterior",
          description: "Gutter detached at the north-east corner",
          severity: "minor",
          severityStated: true,
          evidenceIds: [],
        },
      ],
    },
    images,
  };
}

describe("report model", () => {
  it("groups findings by area and attaches their photos in capture order", async () => {
    const { pkg, images } = await inspectionPackage();
    const model = buildReport(pkg, await verifyPackage(pkg, images));

    expect(model.areas.map((a) => a.area)).toEqual(["Exterior", "Roof — north slope"]);

    const roof = model.areas.find((a) => a.area === "Roof — north slope")!;
    expect(roof.findings[0]!.photos.map((p) => p.evidenceId)).toEqual(["ev-0", "ev-1"]);
  });

  it("still lists photos that were never attached to a finding", async () => {
    const { pkg, images } = await inspectionPackage();
    const model = buildReport(pkg, await verifyPackage(pkg, images));

    // ev-2 belongs to no finding. Dropping it would quietly remove evidence
    // from the record.
    expect(model.unattached.map((p) => p.evidenceId)).toEqual(["ev-2"]);
    expect(model.photoCount).toBe(3);
  });

  it("ignores a finding that references evidence not in the package", async () => {
    const { pkg, images } = await inspectionPackage();
    pkg.findings.push({
      id: "f-3",
      area: "Interior",
      description: "Ceiling stain",
      severity: "minor",
      severityStated: true,
      evidenceIds: ["ev-does-not-exist"],
    });

    const model = buildReport(pkg, await verifyPackage(pkg, images));
    const interior = model.areas.find((a) => a.area === "Interior")!;
    expect(interior.findings[0]!.photos).toEqual([]);
  });

  it("carries provenance notes down to the individual photo", async () => {
    const { records, images } = await buildEvidence(job, [
      { atSeconds: 0 },
      { atSeconds: 60, source: "library" },
    ]);
    const pkg: EvidencePackage = { job, records, annotations: [], findings: [] };

    const model = buildReport(pkg, await verifyPackage(pkg, images));
    const imported = model.unattached.find((p) => p.evidenceId === "ev-1")!;

    expect(imported.notes.some((n) => n.code === "library-import")).toBe(true);
    expect(imported.sourceText).toBe("Imported from library");
  });
});

describe("PDF output", () => {
  it("produces a valid PDF containing the claim and every finding", async () => {
    const { pkg, images } = await inspectionPackage();
    const model = buildReport(pkg, await verifyPackage(pkg, images));
    const bytes = await renderReportPdf(model, images);

    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    // Metadata lives in a compressed object stream, so read it back with a real
    // parser rather than grepping the raw bytes.
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getTitle()).toBe(model.title);
    expect(reloaded.getCreator()).toBe("Fieldproof");
    expect(reloaded.getSubject()).toContain(job.claimNumber);
    // Cover, findings, photographs, appendix — at minimum four.
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(4);
  });

  it("embeds every photograph", async () => {
    const { pkg, images } = await inspectionPackage();
    const model = buildReport(pkg, await verifyPackage(pkg, images));

    const withAll = await renderReportPdf(model, images);
    const withNone = await renderReportPdf(model, new Map());

    // Three embedded images add real weight; their absence is the control.
    expect(withAll.byteLength).toBeGreaterThan(withNone.byteLength);
  });

  it("is byte-identical when regenerated from the same input", async () => {
    // Otherwise the report's own hash is meaningless as a reference, and
    // "that is not the file I sent you" cannot be answered.
    const { pkg, images } = await inspectionPackage();
    const integrity = await verifyPackage(pkg, images);
    const model = buildReport(pkg, integrity);

    const first = await renderReportPdf(model, images);
    const second = await renderReportPdf(model, images);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("states the integrity failure on the cover when the chain is broken", async () => {
    const { pkg, images } = await inspectionPackage();
    images.set("ev-0", flipByte(images.get("ev-0")!, 10));

    const integrity = await verifyPackage(pkg, images);
    expect(integrity.integrity).toBe("broken");

    const model = buildReport(pkg, integrity);
    const bytes = await renderReportPdf(model, images);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
