import { describe, expect, it } from "vitest";
import { InspectionSession } from "../src/core/session.js";
import { MockCamera, MockClock, MockLocation } from "../src/capture/mock.js";
import { PROPERTY, INSPECTION_START, makeJob } from "./support/fixtures.js";

function makeSession(fix = { ...PROPERTY, accuracyMetres: 6 }) {
  const clock = new MockClock(INSPECTION_START);
  const session = new InspectionSession(makeJob(), {
    camera: new MockCamera(),
    location: new MockLocation(fix),
    clock,
  });
  return { session, clock };
}

describe("capture through to a verified package", () => {
  it("builds a chain that verifies against the captured bytes", async () => {
    const { session, clock } = makeSession();

    await session.addPhoto();
    clock.advance();
    await session.addPhoto();
    clock.advance();
    await session.addPhoto();

    const report = await session.verify();

    expect(session.evidence).toHaveLength(3);
    expect(report.integrity).toBe("intact");
    expect(report.provenance).toBe("clean");
    expect(report.contentVerified).toBe(3);
  });

  it("numbers evidence in capture order and links each to the last", async () => {
    const { session, clock } = makeSession();
    await session.addPhoto();
    clock.advance();
    await session.addPhoto();

    const [first, second] = session.evidence;
    expect(first!.sequence).toBe(0);
    expect(second!.sequence).toBe(1);
    expect(second!.previousHash).toBe(first!.recordHash);
  });

  it("records a library pick with a different source", async () => {
    const { session, clock } = makeSession();
    await session.addPhoto("camera");
    clock.advance();
    await session.addPhoto("library");

    const report = await session.verify();

    expect(session.evidence[1]!.source).toBe("library");
    expect(report.integrity).toBe("intact");
    expect(report.provenanceIssues.some((i) => i.code === "library-import")).toBe(true);
  });

  it("still verifies when no location is available", async () => {
    // A basement with no GPS lock is ordinary work, not a failure.
    const noFix = new InspectionSession(makeJob(), {
      camera: new MockCamera(),
      location: new MockLocation(undefined),
      clock: new MockClock(INSPECTION_START),
    });

    await noFix.addPhoto();
    const report = await noFix.verify();

    expect(report.integrity).toBe("intact");
    expect(report.provenanceIssues.some((i) => i.code === "no-location")).toBe(true);
  });
});

describe("findings and annotations", () => {
  it("attaches evidence to a finding without disturbing the chain", async () => {
    const { session, clock } = makeSession();
    const first = await session.addPhoto();
    clock.advance();
    await session.addPhoto();

    const finding = session.addFinding({
      area: "Roof",
      description: "Lifted shingles",
      severity: "moderate",
      evidenceIds: [],
    });
    session.attach(first.id, finding.id);
    session.setCaption(first.id, "North slope");

    const report = await session.verify();

    expect(report.integrity).toBe("intact");
    expect(session.observations[0]!.evidenceIds).toEqual([first.id]);
  });

  it("does not attach the same evidence twice", async () => {
    const { session } = makeSession();
    const photo = await session.addPhoto();
    const finding = session.addFinding({
      area: "Roof",
      description: "Lifted shingles",
      severity: "moderate",
      evidenceIds: [],
    });

    session.attach(photo.id, finding.id);
    session.attach(photo.id, finding.id);

    expect(session.observations[0]!.evidenceIds).toEqual([photo.id]);
  });

  it("produces a PDF for the whole inspection", async () => {
    const { session, clock } = makeSession();
    const photo = await session.addPhoto();
    clock.advance();
    await session.addPhoto();

    const finding = session.addFinding({
      area: "Kitchen",
      description: "Ceiling staining",
      severity: "minor",
      evidenceIds: [],
    });
    session.attach(photo.id, finding.id);

    const pdf = await session.renderPdf();

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
