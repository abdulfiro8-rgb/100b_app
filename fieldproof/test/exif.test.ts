import { describe, expect, it } from "vitest";
import { compareExif, readExif, type ExifFacts } from "../src/core/exif.js";
import { verifyPackage } from "../src/core/verify.js";
import {
  INSPECTION_START,
  PROPERTY,
  buildEvidence,
  goodInspection,
  makeJob,
  offsetMetres,
} from "./support/fixtures.js";

const job = makeJob();

async function records() {
  const built = await buildEvidence(job, goodInspection());
  return built;
}

describe("comparing EXIF with the capture record", () => {
  it("says nothing when the file carries no metadata", async () => {
    // The common case. PNGs usually have none, and plenty of pipelines strip
    // it — silence here must not read as suspicion.
    const { records: recs } = await records();
    expect(compareExif(recs[0]!, undefined)).toBeUndefined();
  });

  it("says nothing when metadata agrees", async () => {
    const { records: recs } = await records();
    const record = recs[0]!;

    const agreeing: ExifFacts = {
      capturedAt: record.capturedAt + 30_000,
      latitude: PROPERTY.latitude,
      longitude: PROPERTY.longitude,
    };

    expect(compareExif(record, agreeing)).toBeUndefined();
  });

  it("flags a file whose own timestamp is days off", async () => {
    const { records: recs } = await records();
    const record = recs[0]!;

    const comparison = compareExif(record, {
      capturedAt: record.capturedAt - 5 * 24 * 60 * 60_000,
    });

    expect(comparison?.disagreements).toEqual(["time"]);
    expect(comparison?.detail).toContain("5 days");
  });

  it("flags a file whose own coordinates are miles away", async () => {
    const { records: recs } = await records();
    const far = offsetMetres(PROPERTY, 4000);

    const comparison = compareExif(recs[0]!, {
      latitude: far.latitude,
      longitude: far.longitude,
    });

    expect(comparison?.disagreements).toEqual(["location"]);
  });

  it("reports both when time and place disagree", async () => {
    const { records: recs } = await records();
    const record = recs[0]!;
    const far = offsetMetres(PROPERTY, 9000);

    const comparison = compareExif(record, {
      capturedAt: record.capturedAt + 3 * 24 * 60 * 60_000,
      latitude: far.latitude,
      longitude: far.longitude,
    });

    expect(comparison?.disagreements).toEqual(["time", "location"]);
  });

  it("tolerates ordinary camera clock drift", async () => {
    const { records: recs } = await records();
    const record = recs[0]!;
    expect(compareExif(record, { capturedAt: record.capturedAt + 15 * 60_000 })).toBeUndefined();
  });

  it("cannot compare a location the app never recorded", async () => {
    const { records: recs } = await records();
    const withoutFix = { ...recs[0]!, location: undefined };
    const far = offsetMetres(PROPERTY, 9000);

    expect(
      compareExif(withoutFix, { latitude: far.latitude, longitude: far.longitude }),
    ).toBeUndefined();
  });
});

describe("EXIF inside verification", () => {
  it("raises exif-mismatch on a disagreeing file", async () => {
    const { records: recs, images } = await records();
    const target = recs[1]!;

    const report = await verifyPackage(
      { job, records: recs, annotations: [], findings: [] },
      images,
      {
        exifReader: async (bytes) =>
          bytes === images.get(target.id)
            ? { capturedAt: INSPECTION_START - 30 * 24 * 60 * 60_000 }
            : undefined,
      },
    );

    const mismatch = report.provenanceIssues.filter((i) => i.code === "exif-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.evidenceId).toBe(target.id);

    // A disagreement is a question about the photograph, not proof the file was
    // altered — the chain is what speaks to that, and it is still intact.
    expect(report.integrity).toBe("intact");
    expect(report.provenance).toBe("questions");
  });

  it("stays clean when no file carries metadata", async () => {
    const { records: recs, images } = await records();

    const report = await verifyPackage(
      { job, records: recs, annotations: [], findings: [] },
      images,
      { exifReader: async () => undefined },
    );

    expect(report.provenance).toBe("clean");
  });
});

describe("reading EXIF from real bytes", () => {
  it("returns undefined for a PNG with no metadata", async () => {
    const { images } = await records();
    // The fixture PNGs carry no EXIF, so this exercises the real parser's
    // empty path rather than an injected stub.
    expect(await readExif(images.get("ev-0")!)).toBeUndefined();
  });

  it("returns undefined for bytes that are not an image at all", async () => {
    expect(await readExif(new TextEncoder().encode("definitely not an image"))).toBeUndefined();
  });
});
