import { useState } from "react";
import { PackageFormatError, readPackage } from "../core/package.js";
import { IntegrityBadge } from "./IntegrityBadge.js";
import { INTEGRITY_STATEMENT, verifyPackage } from "../core/verify.js";
import type { IntegrityReport } from "../core/verify.js";
import type { Job } from "../core/types.js";

/**
 * Checks a package this device did not create.
 *
 * This is what makes the integrity claim worth anything. Verification that only
 * worked inside the app that produced the evidence would prove nothing to the
 * examiner on the other side of a disputed claim — so the same check has to run
 * against a file that arrived by email.
 */
export function VerifyScreen() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function check(file: File) {
    setChecking(true);
    setError(null);
    setReport(null);
    setJob(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opened = readPackage(bytes);
      setJob(opened.pkg.job);
      setReport(await verifyPackage(opened.pkg, opened.images));
    } catch (cause) {
      setError(
        cause instanceof PackageFormatError
          ? cause.message
          : "That file could not be read as an evidence package.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Verify a package</h2>
        <p className="sub">
          Open an <code className="inline">.fpx</code> file from anyone. Nothing is uploaded — the
          check runs here.
        </p>

        <label className="button" style={{ display: "block" }}>
          {checking ? "Checking…" : "Choose .fpx file"}
          <input
            type="file"
            accept=".fpx,application/zip"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void check(file);
            }}
          />
        </label>

        {error && <div className="notice error">{error}</div>}
      </section>

      {report && job && (
        <>
          {/* Reuses the inspection badge so an examiner sees exactly the same
              verdict and wording the inspector saw. */}
          <IntegrityBadge report={report} />

          <section className="card">
            <h2>{job.claimNumber}</h2>
            <p className="sub" style={{ marginBottom: 8 }}>
              {job.propertyAddress} · {job.insuredName} · inspected by {job.inspectorName}
            </p>

            {[...report.chainIssues, ...report.contentIssues].length > 0 && (
              <>
                <h3 style={{ fontSize: 13, margin: "10px 0 4px" }}>Integrity problems</h3>
                <ul className="badge-notes">
                  {report.chainIssues.map((issue, i) => (
                    <li key={`c${i}`}>{issue.detail}</li>
                  ))}
                  {report.contentIssues.map((issue, i) => (
                    <li key={`f${i}`}>{issue.detail}</li>
                  ))}
                </ul>
              </>
            )}

            {report.provenanceIssues.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, margin: "12px 0 4px" }}>Provenance notes</h3>
                <ul className="badge-notes">
                  {report.provenanceIssues.map((issue, i) => (
                    <li key={i}>{issue.detail}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <h2>What this check means</h2>
            <h3 style={{ fontSize: 13, margin: "8px 0 4px" }}>It establishes</h3>
            <ul className="badge-notes">
              {INTEGRITY_STATEMENT.establishes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <h3 style={{ fontSize: 13, margin: "12px 0 4px" }}>It does not establish</h3>
            <ul className="badge-notes">
              {INTEGRITY_STATEMENT.doesNotEstablish.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
