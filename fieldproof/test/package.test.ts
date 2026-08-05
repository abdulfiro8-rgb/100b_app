import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  PackageFormatError,
  packageFileName,
  readPackage,
  writePackage,
} from "../src/core/package.js";
import { sha256Hex } from "../src/core/chain.js";
import { verifyPackage, type EvidencePackage } from "../src/core/verify.js";
import { buildEvidence, flipByte, goodInspection, makeJob } from "./support/fixtures.js";

const job = makeJob();

async function exported() {
  const { records, images } = await buildEvidence(job, goodInspection());
  const pkg: EvidencePackage = {
    job,
    records,
    annotations: [{ evidenceId: "ev-0", caption: "North elevation" }],
    findings: [
      {
        id: "f-1",
        area: "Roof",
        description: "Lifted shingles",
        severity: "moderate",
        severityStated: true,
        evidenceIds: ["ev-0"],
      },
    ],
  };
  return { pkg, images, bytes: writePackage(pkg, images, 1_760_000_000_000) };
}

describe("round trip", () => {
  it("verifies after export and re-import, with no state carried over", async () => {
    // The point of the format: a package must verify for someone who was not
    // there and has nothing but the file.
    const { bytes } = await exported();

    const reopened = readPackage(bytes);
    const report = await verifyPackage(reopened.pkg, reopened.images);

    expect(report.integrity).toBe("intact");
    expect(report.provenance).toBe("clean");
    expect(report.contentVerified).toBe(3);
  });

  it("preserves findings and captions", async () => {
    const { bytes } = await exported();
    const { pkg } = readPackage(bytes);

    expect(pkg.findings[0]!.description).toBe("Lifted shingles");
    expect(pkg.annotations[0]!.caption).toBe("North elevation");
  });

  it("is deterministic for identical input", async () => {
    const { pkg, images } = await exported();
    const a = writePackage(pkg, images, 1_760_000_000_000);
    const b = writePackage(pkg, images, 1_760_000_000_000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("a package an examiner can open without this app", () => {
  it("is an ordinary zip with readable entries", async () => {
    const { bytes } = await exported();
    const entries = unzipSync(bytes);

    expect(Object.keys(entries)).toContain("manifest.json");
    expect(Object.keys(entries)).toContain("README.txt");
    expect(Object.keys(entries).filter((n) => n.startsWith("evidence/"))).toHaveLength(3);
  });

  it("lets a hash be checked by hand against the manifest", async () => {
    // Someone with unzip and sha256sum should be able to confirm a photograph
    // without trusting any of our code.
    const { bytes } = await exported();
    const entries = unzipSync(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]!));

    const record = manifest.records[0];
    const fileName = manifest.files[record.id];
    expect(await sha256Hex(entries[fileName]!)).toBe(record.contentHash);
  });

  it("states its own limits in the README", async () => {
    const { bytes } = await exported();
    const readme = new TextDecoder().decode(unzipSync(bytes)["README.txt"]!);

    expect(readme).toContain("does not establish");
    expect(readme).toContain("SHA-256");
  });
});

describe("tampering with a package in transit", () => {
  it("catches a swapped photograph and names the file", async () => {
    const { bytes } = await exported();
    const entries = unzipSync(bytes);

    const reopened = readPackage(bytes);
    const target = reopened.pkg.records[1]!;
    const fileName = `evidence/${target.id}.png`;
    reopened.images.set(target.id, flipByte(entries[fileName]!, 12));

    const report = await verifyPackage(reopened.pkg, reopened.images);

    expect(report.integrity).toBe("broken");
    expect(report.contentIssues[0]).toMatchObject({
      code: "content-mismatch",
      evidenceId: target.id,
    });
  });

  it("catches records edited in the manifest", async () => {
    const { pkg, images } = await exported();
    const doctored: EvidencePackage = {
      ...pkg,
      records: pkg.records.map((r) =>
        r.id === "ev-1" ? { ...r, capturedAt: r.capturedAt - 86_400_000 } : r,
      ),
    };

    const reopened = readPackage(writePackage(doctored, images, 1_760_000_000_000));
    const report = await verifyPackage(reopened.pkg, reopened.images);

    expect(report.integrity).toBe("broken");
    expect(report.chainIssues.some((i) => i.code === "record-hash-mismatch")).toBe(true);
  });

  it("reports a package with a photograph stripped out as unverifiable", async () => {
    const { bytes } = await exported();
    const reopened = readPackage(bytes);
    reopened.images.delete("ev-2");

    const report = await verifyPackage(reopened.pkg, reopened.images);

    // Missing is not the same accusation as altered.
    expect(report.contentIssues[0]!.code).toBe("content-missing");
    expect(report.contentVerified).toBe(2);
  });
});

describe("malformed input", () => {
  it("rejects something that is not an archive", () => {
    expect(() => readPackage(new TextEncoder().encode("not a zip"))).toThrow(PackageFormatError);
  });

  it("rejects an archive with no manifest", () => {
    const bogus = zipSync({ "hello.txt": new TextEncoder().encode("hi") });
    expect(() => readPackage(bogus)).toThrow(/manifest/i);
  });

  it("refuses to export when an image is missing rather than shipping a broken package", async () => {
    const { pkg, images } = await exported();
    images.delete("ev-1");
    expect(() => writePackage(pkg, images)).toThrow(PackageFormatError);
  });

  it("names the file after the claim", () => {
    expect(packageFileName(job)).toBe("CLM-2026-0042.fpx");
  });
});
