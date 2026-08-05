import { describe, expect, it } from "vitest";
import { verifyChain } from "../src/core/chain.js";
import { verifyPackage, type EvidencePackage } from "../src/core/verify.js";
import type { EvidenceRecord } from "../src/core/types.js";
import { buildEvidence, flipByte, goodInspection, makeJob } from "./support/fixtures.js";

const job = makeJob();

function pkg(records: EvidenceRecord[]): EvidencePackage {
  return { job, records, annotations: [], findings: [] };
}

describe("an untouched package", () => {
  it("verifies clean, with no false alarms", async () => {
    // This matters more than any tamper case: a verifier that flags honest work
    // gets switched off, and then it protects nobody.
    const { records, images } = await buildEvidence(job, goodInspection());
    const report = await verifyPackage(pkg(records), images);

    expect(report.integrity).toBe("intact");
    expect(report.provenance).toBe("clean");
    expect(report.contentVerified).toBe(3);
    expect(report.chainIssues).toEqual([]);
    expect(report.contentIssues).toEqual([]);
    expect(report.provenanceIssues).toEqual([]);
  });
});

describe("tampering with image contents", () => {
  it("detects an edited photo and names it", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());

    images.set("ev-1", flipByte(images.get("ev-1")!, 12));

    const report = await verifyPackage(pkg(records), images);

    expect(report.integrity).toBe("broken");
    expect(report.contentIssues).toHaveLength(1);
    expect(report.contentIssues[0]).toMatchObject({
      code: "content-mismatch",
      evidenceId: "ev-1",
    });
    // The other two are untouched and must still verify.
    expect(report.contentVerified).toBe(2);
  });

  it("detects a photo swapped for a different one", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    images.set("ev-0", images.get("ev-2")!);

    const report = await verifyPackage(pkg(records), images);
    expect(report.integrity).toBe("broken");
    expect(report.contentIssues.some((i) => i.evidenceId === "ev-0")).toBe(true);
  });

  it("reports a missing file as unverifiable rather than as tampering", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    images.delete("ev-1");

    const report = await verifyPackage(pkg(records), images);

    // An incomplete package is a different problem from a corrupted one, and
    // calling it tampering would be an accusation the evidence does not support.
    expect(report.contentIssues[0]!.code).toBe("content-missing");
    expect(report.integrity).toBe("intact");
    expect(report.contentVerified).toBe(2);
  });
});

describe("tampering with the record chain", () => {
  it("detects an edited capture time", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const doctored = records.map((r) =>
      r.id === "ev-1" ? { ...r, capturedAt: r.capturedAt - 3 * 60 * 60_000 } : r,
    );

    const report = await verifyPackage(pkg(doctored), images);

    expect(report.integrity).toBe("broken");
    expect(report.chainIssues.some((i) => i.code === "record-hash-mismatch")).toBe(true);
  });

  it("detects an edited location", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const doctored = records.map((r) =>
      r.id === "ev-2"
        ? { ...r, location: { latitude: 0, longitude: 0, accuracyMetres: 5 } }
        : r,
    );

    const report = await verifyPackage(pkg(doctored), images);
    expect(report.chainIssues.some((i) => i.code === "record-hash-mismatch")).toBe(true);
  });

  it("detects a record deleted from the middle", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const withHole = [records[0]!, records[2]!];

    const issues = await verifyChain(withHole, job.id);

    // Both the broken link and the sequence jump are reported: either alone
    // could be explained away, together they are unambiguous.
    expect(issues.some((i) => i.code === "broken-link")).toBe(true);
    expect(issues.some((i) => i.code === "sequence-gap")).toBe(true);

    const report = await verifyPackage(pkg(withHole), images);
    expect(report.integrity).toBe("broken");
  });

  it("detects reordered records", async () => {
    const { records } = await buildEvidence(job, goodInspection());
    const shuffled = [records[0]!, records[2]!, records[1]!];

    const issues = await verifyChain(shuffled, job.id);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.code === "broken-link")).toBe(true);
  });

  it("rejects a chain lifted from another job", async () => {
    const { records } = await buildEvidence(makeJob({ id: "job-other" }), goodInspection());

    // The genesis link binds a chain to its job, so evidence cannot be
    // transplanted onto a different claim and still verify.
    const issues = await verifyChain(records, job.id);
    expect(issues.some((i) => i.code === "wrong-job")).toBe(true);
    expect(issues.some((i) => i.code === "genesis-mismatch")).toBe(true);
  });

  it("cannot be repaired by recomputing one record's hash", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());

    // Someone edits a timestamp and patches that record's own hash to match.
    // The following record still commits to the *old* hash, so the chain breaks
    // one link later — which is the whole point of chaining.
    const { computeRecordHash } = await import("../src/core/chain.js");
    const target = records[1]!;
    const edited = { ...target, capturedAt: target.capturedAt - 60_000 };
    const repaired: EvidenceRecord = {
      ...edited,
      recordHash: await computeRecordHash({
        sequence: edited.sequence,
        jobId: edited.jobId,
        contentHash: edited.contentHash,
        byteLength: edited.byteLength,
        mimeType: edited.mimeType,
        capturedAt: edited.capturedAt,
        monotonicMs: edited.monotonicMs,
        location: edited.location,
        source: edited.source,
        previousHash: edited.previousHash,
      }),
    };

    const report = await verifyPackage(pkg([records[0]!, repaired, records[2]!]), images);

    expect(report.integrity).toBe("broken");
    expect(report.chainIssues.some((i) => i.code === "broken-link")).toBe(true);
  });
});

describe("annotations stay outside the chain", () => {
  it("captioning a photo afterwards does not break verification", async () => {
    // Writing up notes after leaving the property is ordinary work. If it
    // tripped the tamper alarm the tool would be unusable.
    const { records, images } = await buildEvidence(job, goodInspection());

    const annotated: EvidencePackage = {
      job,
      records,
      annotations: [
        { evidenceId: "ev-0", caption: "North elevation, missing shingles" },
        { evidenceId: "ev-1", caption: "Close-up of ridge damage", findingId: "f-1" },
      ],
      findings: [
        {
          id: "f-1",
          area: "Roof — north slope",
          description: "Wind-lifted shingles along the ridge",
          severity: "moderate",
          severityStated: true,
          evidenceIds: ["ev-1"],
        },
      ],
    };

    const report = await verifyPackage(annotated, images);
    expect(report.integrity).toBe("intact");
  });
});
