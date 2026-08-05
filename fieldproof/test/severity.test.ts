import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { DictationController } from "../src/ai/dictation.js";
import { ScriptedDictation } from "../src/ai/mock.js";
import { InspectionSession } from "../src/core/session.js";
import { MockCamera, MockClock, MockLocation } from "../src/capture/mock.js";
import { buildReport } from "../src/core/report.js";
import { readPackage, writePackage } from "../src/core/package.js";
import { verifyPackage, type EvidencePackage } from "../src/core/verify.js";
import { clearAll, loadInspection, saveFindings, saveJob } from "../src/store/db.js";
import { INSPECTION_START, PROPERTY, buildEvidence, goodInspection, makeJob } from "./support/fixtures.js";

const job = makeJob();

function deps() {
  return {
    camera: new MockCamera(),
    location: new MockLocation({ ...PROPERTY, accuracyMetres: 6 }),
    clock: new MockClock(INSPECTION_START),
  };
}

beforeEach(async () => {
  await clearAll();
});

describe("an ungraded observation stays visibly ungraded", () => {
  it("marks a finding whose severity was never spoken", async () => {
    // The whole point: nobody said how bad this is, so the app must not file a
    // grade as though somebody did.
    const c = new DictationController(
      new ScriptedDictation([
        { text: "Kitchen: cabinet doors swollen at the base.", final: true },
      ]),
    );
    await c.start();

    const [draft] = await c.toFindings();
    expect(draft!.severityStated).toBe(false);
    expect(draft!.severity).toBe("minor");
  });

  it("does not mark one that was graded out loud", async () => {
    const c = new DictationController(
      new ScriptedDictation([{ text: "Roof: decking exposed, extensive.", final: true }]),
    );
    await c.start();

    const [draft] = await c.toFindings();
    expect(draft!.severityStated).toBe(true);
    expect(draft!.severity).toBe("severe");
  });
});

describe("confirming a severity", () => {
  it("marks it confirmed and survives a reload", async () => {
    await saveJob(job);
    const session = new InspectionSession(job, deps());

    const finding = session.addFinding({
      area: "Kitchen",
      description: "Cabinet doors swollen at the base",
      severity: "minor",
      severityStated: false,
      evidenceIds: [],
    });
    await saveFindings(job.id, session.observations);

    // The adjuster grades it.
    session.updateFinding(finding.id, { severity: "moderate", severityStated: true });
    await saveFindings(job.id, session.observations);

    const stored = await loadInspection(job.id);
    const restored = InspectionSession.hydrate(stored!.job, deps(), stored!);

    expect(restored.observations[0]).toMatchObject({
      severity: "moderate",
      severityStated: true,
    });
  });

  it("keeps an unconfirmed finding unconfirmed across a reload", async () => {
    await saveJob(job);
    const session = new InspectionSession(job, deps());
    session.addFinding({
      area: "Kitchen",
      description: "Cabinet doors swollen",
      severity: "minor",
      severityStated: false,
      evidenceIds: [],
    });
    await saveFindings(job.id, session.observations);

    const stored = await loadInspection(job.id);
    expect(stored!.findings[0]!.severityStated).toBe(false);
  });

  it("persists an edited description without disturbing verification", async () => {
    // Findings are interpretation, not evidence — editing one must never look
    // like tampering.
    await saveJob(job);
    const { records, images } = await buildEvidence(job, goodInspection());
    const session = InspectionSession.hydrate(job, deps(), {
      records,
      images,
      annotations: [],
      findings: [],
    });

    const finding = session.addFinding({
      area: "Roof",
      description: "Lifted shingers",
      severity: "moderate",
      severityStated: true,
      evidenceIds: [],
    });
    session.updateFinding(finding.id, { description: "Lifted shingles" });

    const report = await session.verify();
    expect(report.integrity).toBe("intact");
    expect(session.observations[0]!.description).toBe("Lifted shingles");
  });
});

describe("the report says so", () => {
  it("counts unconfirmed severities", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const pkg: EvidencePackage = {
      job,
      records,
      annotations: [],
      findings: [
        {
          id: "f-1",
          area: "Roof",
          description: "Lifted shingles",
          severity: "moderate",
          severityStated: true,
          evidenceIds: [],
        },
        {
          id: "f-2",
          area: "Kitchen",
          description: "Cabinet doors swollen",
          severity: "minor",
          severityStated: false,
          evidenceIds: [],
        },
      ],
    };

    const model = buildReport(pkg, await verifyPackage(pkg, images));

    expect(model.unconfirmedSeverities).toBe(1);
    const kitchen = model.areas.find((a) => a.area === "Kitchen")!;
    expect(kitchen.findings[0]!.severityStated).toBe(false);
  });

  it("reports none when everything was graded", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const pkg: EvidencePackage = {
      job,
      records,
      annotations: [],
      findings: [
        {
          id: "f-1",
          area: "Roof",
          description: "Lifted shingles",
          severity: "moderate",
          severityStated: true,
          evidenceIds: [],
        },
      ],
    };

    const model = buildReport(pkg, await verifyPackage(pkg, images));
    expect(model.unconfirmedSeverities).toBe(0);
  });
});

describe("packages written before this field existed", () => {
  it("open with findings treated as confirmed, not retroactively accused", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());

    // A manifest exactly as an older build would have written it.
    const legacy = {
      format: "fieldproof-evidence",
      version: 1,
      exportedAt: 1_760_000_000_000,
      job,
      records,
      annotations: [],
      findings: [
        {
          id: "f-1",
          area: "Roof",
          description: "Lifted shingles",
          severity: "moderate",
          evidenceIds: [],
        },
      ],
      files: Object.fromEntries(records.map((r) => [r.id, `evidence/${r.id}.png`])),
    };

    const entries: Record<string, Uint8Array> = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(legacy)),
    };
    for (const record of records) entries[`evidence/${record.id}.png`] = images.get(record.id)!;

    const opened = readPackage(zipSync(entries, { mtime: Date.UTC(1980, 0, 1) }));

    expect(opened.pkg.findings[0]!.severityStated).toBe(true);
    expect((await verifyPackage(opened.pkg, opened.images)).integrity).toBe("intact");
  });

  it("round-trips the flag for packages that do carry it", async () => {
    const { records, images } = await buildEvidence(job, goodInspection());
    const pkg: EvidencePackage = {
      job,
      records,
      annotations: [],
      findings: [
        {
          id: "f-1",
          area: "Kitchen",
          description: "Cabinet doors swollen",
          severity: "minor",
          severityStated: false,
          evidenceIds: [],
        },
      ],
    };

    const opened = readPackage(writePackage(pkg, images, 1_760_000_000_000));
    expect(opened.pkg.findings[0]!.severityStated).toBe(false);
  });
});
