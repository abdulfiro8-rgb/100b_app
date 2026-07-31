import { describe, expect, it } from "vitest";
import { checkProvenance } from "../src/core/provenance.js";
import {
  INSPECTION_START,
  PROPERTY,
  buildEvidence,
  goodInspection,
  makeJob,
  offsetMetres,
} from "./support/fixtures.js";

const job = makeJob();

async function issuesFor(specs: Parameters<typeof buildEvidence>[1]) {
  const { records } = await buildEvidence(job, specs);
  return checkProvenance(records, job);
}

describe("location", () => {
  it("raises nothing for photos taken at the property", async () => {
    expect(await issuesFor(goodInspection())).toEqual([]);
  });

  it("does not flag photos around the grounds", async () => {
    // Back fence, outbuildings and street frontage are all normal.
    const issues = await issuesFor([
      { atSeconds: 0, location: { ...offsetMetres(PROPERTY, 60), accuracyMetres: 8 } },
      { atSeconds: 60, location: { ...offsetMetres(PROPERTY, -90), accuracyMetres: 8 } },
    ]);
    expect(issues).toEqual([]);
  });

  it("flags a photo taken 800 m away", async () => {
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 60, location: { ...offsetMetres(PROPERTY, 800), accuracyMetres: 6 } },
    ]);

    const far = issues.filter((i) => i.code === "far-from-property");
    expect(far).toHaveLength(1);
    expect(far[0]!.level).toBe("critical");
    expect(far[0]!.evidenceId).toBe("ev-1");
    // The fixture offsets by a flat-earth approximation, so the reported
    // great-circle distance lands near but not exactly on 800 m.
    expect(far[0]!.detail).toMatch(/\b79\d|80\d\b/);
  });

  it("charges GPS uncertainty against the distance before accusing anyone", async () => {
    // 300 m out but only accurate to ±150 m is not evidence of anything, and
    // treating it as such would flood a rural inspection with false alarms.
    const issues = await issuesFor([
      { atSeconds: 0, location: { ...offsetMetres(PROPERTY, 300), accuracyMetres: 150 } },
    ]);

    expect(issues.some((i) => i.code === "far-from-property")).toBe(false);
    expect(issues.some((i) => i.code === "poor-accuracy")).toBe(true);
  });

  it("warns when a fix was never obtained", async () => {
    const { records } = await buildEvidence(job, goodInspection());
    const noFix = records.map((r, i) => (i === 1 ? { ...r, location: undefined } : r));

    const issues = checkProvenance(noFix, job);
    const missing = issues.filter((i) => i.code === "no-location");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.level).toBe("warning");
  });
});

describe("clock", () => {
  it("flags a photo timestamped before the one preceding it", async () => {
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 120, wallClockOverride: INSPECTION_START - 60_000 },
    ]);

    const backwards = issues.filter((i) => i.code === "clock-moved-backwards");
    expect(backwards).toHaveLength(1);
    expect(backwards[0]!.level).toBe("critical");
  });

  it("catches the device clock being wound forward mid-inspection", async () => {
    // Two minutes of real elapsed time, but the wall clock claims two hours:
    // the monotonic clock is what gives it away.
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 120, wallClockOverride: INSPECTION_START + 2 * 60 * 60_000 },
    ]);

    expect(issues.some((i) => i.code === "clock-inconsistent")).toBe(true);
  });

  it("tolerates small drift without complaining", async () => {
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 120, wallClockOverride: INSPECTION_START + 120_000 + 5_000 },
    ]);

    expect(issues.some((i) => i.code === "clock-inconsistent")).toBe(false);
  });

  it("does not mistake an app restart for tampering", async () => {
    // Reopening the app resets its monotonic origin. That is ordinary, and says
    // nothing about the wall clock.
    const { records } = await buildEvidence(job, goodInspection());
    const restarted = records.map((r, i) => (i === 2 ? { ...r, monotonicMs: 5_000 } : r));

    const issues = checkProvenance(restarted, job);
    expect(issues.some((i) => i.code === "clock-inconsistent")).toBe(false);
    expect(issues.some((i) => i.code === "clock-moved-backwards")).toBe(false);
  });
});

describe("source", () => {
  it("distinguishes a library import from a live capture", async () => {
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 60, source: "library" },
    ]);

    const imported = issues.filter((i) => i.code === "library-import");
    expect(imported).toHaveLength(1);
    expect(imported[0]!.evidenceId).toBe("ev-1");
  });

  it("flags images whose origin was never recorded", async () => {
    const issues = await issuesFor([{ atSeconds: 0, source: "unknown" }]);
    expect(issues.some((i) => i.code === "unknown-source")).toBe(true);
  });
});

describe("inspection window", () => {
  it("flags a photo captured days from the inspection", async () => {
    const issues = await issuesFor([
      { atSeconds: 0 },
      { atSeconds: 60, wallClockOverride: INSPECTION_START + 4 * 24 * 60 * 60_000 },
    ]);

    expect(issues.some((i) => i.code === "outside-inspection-window")).toBe(true);
  });
});
