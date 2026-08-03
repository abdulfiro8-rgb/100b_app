import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendEvidence,
  clearAll,
  deleteJob,
  listJobs,
  loadInspection,
  saveAnnotation,
  saveFindings,
  saveJob,
} from "../src/store/db.js";
import { InspectionSession } from "../src/core/session.js";
import { MockCamera, MockClock, MockLocation } from "../src/capture/mock.js";
import { verifyPackage } from "../src/core/verify.js";
import { INSPECTION_START, PROPERTY, flipByte, makeJob } from "./support/fixtures.js";

const job = makeJob();

function deps() {
  return {
    camera: new MockCamera(),
    location: new MockLocation({ ...PROPERTY, accuracyMetres: 6 }),
    clock: new MockClock(INSPECTION_START),
  };
}

/** Captures an inspection and writes every part of it to storage. */
async function captureAndPersist(photos = 3) {
  const d = deps();
  const session = new InspectionSession(job, d);
  await saveJob(job);

  for (let i = 0; i < photos; i++) {
    const record = await session.addPhoto();
    await appendEvidence(record, session.imageFor(record.id)!);
    (d.clock as MockClock).advance();
  }

  session.setCaption(session.evidence[0]!.id, "North elevation");
  await saveAnnotation({ evidenceId: session.evidence[0]!.id, caption: "North elevation" });

  const finding = session.addFinding({
    area: "Roof",
    description: "Lifted shingles",
    severity: "moderate",
    evidenceIds: [session.evidence[0]!.id],
  });
  await saveFindings(job.id, [finding]);

  return session;
}

beforeEach(async () => {
  await clearAll();
});

describe("reload", () => {
  it("restores an inspection that still verifies", async () => {
    // The whole point: closing the app must not weaken the evidence.
    await captureAndPersist();

    const stored = await loadInspection(job.id);
    expect(stored).toBeDefined();

    const restored = InspectionSession.hydrate(stored!.job, deps(), stored!);
    const report = await restored.verify();

    expect(restored.evidence).toHaveLength(3);
    expect(report.integrity).toBe("intact");
    expect(report.contentVerified).toBe(3);
  });

  it("restores captions and findings", async () => {
    await captureAndPersist();
    const stored = await loadInspection(job.id);

    expect(stored!.annotations[0]!.caption).toBe("North elevation");
    expect(stored!.findings[0]!.description).toBe("Lifted shingles");
    // The jobId column used for indexing must not leak into the domain object.
    expect(stored!.findings[0]).not.toHaveProperty("jobId");
  });

  it("restores evidence in capture order regardless of storage order", async () => {
    await captureAndPersist(4);
    const stored = await loadInspection(job.id);

    expect(stored!.records.map((r) => r.sequence)).toEqual([0, 1, 2, 3]);
  });

  it("survives a second round trip unchanged", async () => {
    await captureAndPersist();
    const first = await loadInspection(job.id);
    const second = await loadInspection(job.id);

    expect(second!.records).toEqual(first!.records);
  });
});

describe("storage must not launder tampering", () => {
  it("catches an image corrupted on disk", async () => {
    // If someone edits the stored blob directly, reload has to notice. A
    // rehydration that recomputed hashes would silently bless the change.
    const session = await captureAndPersist();
    const target = session.evidence[1]!;

    await appendEvidence(target, flipByte(session.imageFor(target.id)!, 12));

    const stored = await loadInspection(job.id);
    const report = await verifyPackage(
      {
        job: stored!.job,
        records: stored!.records,
        annotations: stored!.annotations,
        findings: stored!.findings,
      },
      stored!.images,
    );

    expect(report.integrity).toBe("broken");
    expect(report.contentIssues[0]).toMatchObject({
      code: "content-mismatch",
      evidenceId: target.id,
    });
  });

  it("catches a record edited on disk", async () => {
    const session = await captureAndPersist();
    const target = session.evidence[2]!;

    await appendEvidence(
      { ...target, capturedAt: target.capturedAt - 86_400_000 },
      session.imageFor(target.id)!,
    );

    const stored = await loadInspection(job.id);
    const restored = InspectionSession.hydrate(stored!.job, deps(), stored!);
    const report = await restored.verify();

    expect(report.integrity).toBe("broken");
    expect(report.chainIssues.some((i) => i.code === "record-hash-mismatch")).toBe(true);
  });

  it("catches a record dropped from storage", async () => {
    await captureAndPersist();
    const stored = await loadInspection(job.id);

    // Simulate a row going missing rather than deleting through the API, which
    // deliberately offers no way to remove evidence.
    const withHole = stored!.records.filter((r) => r.sequence !== 1);
    const report = await verifyPackage(
      { job: stored!.job, records: withHole, annotations: [], findings: [] },
      stored!.images,
    );

    expect(report.integrity).toBe("broken");
    expect(report.chainIssues.some((i) => i.code === "broken-link")).toBe(true);
  });
});

describe("captions", () => {
  it("persists a caption written after the fact without disturbing the chain", async () => {
    // Captions sit outside the hash chain by design: writing one up an hour
    // after leaving the property is ordinary work, not tampering.
    const session = await captureAndPersist();
    const target = session.evidence[2]!;

    await saveAnnotation({ evidenceId: target.id, caption: "Ridge, close up" });

    const stored = await loadInspection(job.id);
    const restored = InspectionSession.hydrate(stored!.job, deps(), stored!);
    const report = await restored.verify();

    expect(stored!.annotations.find((a) => a.evidenceId === target.id)?.caption).toBe(
      "Ridge, close up",
    );
    expect(report.integrity).toBe("intact");
  });

  it("replaces a caption rather than accumulating duplicates", async () => {
    const session = await captureAndPersist();
    const id = session.evidence[0]!.id;

    await saveAnnotation({ evidenceId: id, caption: "First" });
    await saveAnnotation({ evidenceId: id, caption: "Corrected" });

    const stored = await loadInspection(job.id);
    const forPhoto = stored!.annotations.filter((a) => a.evidenceId === id);

    expect(forPhoto).toHaveLength(1);
    expect(forPhoto[0]!.caption).toBe("Corrected");
  });
});

describe("jobs", () => {
  it("lists saved jobs newest first", async () => {
    await saveJob(makeJob({ id: "a", inspectedAt: 1000 }));
    await saveJob(makeJob({ id: "b", inspectedAt: 5000 }));

    expect((await listJobs()).map((j) => j.id)).toEqual(["b", "a"]);
  });

  it("returns undefined for a job that does not exist", async () => {
    expect(await loadInspection("nope")).toBeUndefined();
  });

  it("removes a job's evidence and images when the job is deleted", async () => {
    await captureAndPersist();
    await deleteJob(job.id);

    expect(await loadInspection(job.id)).toBeUndefined();
    expect(await listJobs()).toEqual([]);
  });

  it("keeps other jobs' evidence separate", async () => {
    await captureAndPersist();

    const other = makeJob({ id: "job-other", claimNumber: "CLM-OTHER" });
    await saveJob(other);
    const otherSession = new InspectionSession(other, deps());
    const record = await otherSession.addPhoto();
    await appendEvidence(record, otherSession.imageFor(record.id)!);

    expect((await loadInspection(job.id))!.records).toHaveLength(3);
    expect((await loadInspection(other.id))!.records).toHaveLength(1);
  });
});
