import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InspectionSession } from "../core/session.js";
import { MockCamera, MockClock, MockLocation } from "../capture/mock.js";
import { RulesStructurer } from "../ai/rules.js";
import type { IntegrityReport } from "../core/verify.js";
import type { Job } from "../core/types.js";

const DEMO_JOB: Job = {
  id: "job-2026-0042",
  claimNumber: "CLM-2026-0042",
  policyNumber: "HO3-889231",
  peril: "wind",
  insuredName: "R. Alvarez",
  propertyAddress: "4118 Cypress Bend Dr, Houston, TX 77068",
  propertyLocation: { latitude: 29.7604, longitude: -95.3698 },
  inspectorName: "J. Whitfield",
  inspectorLicense: "TX-IA-55821",
  inspectedAt: Date.now(),
  tzOffsetMinutes: -300,
};

const structurer = new RulesStructurer();

/**
 * Drives an `InspectionSession` from React.
 *
 * The session is mutable and lives in a ref; a version counter forces renders.
 * Copying the whole evidence chain into state on every capture would be both
 * wasteful and a second place for it to drift out of sync with the hashes.
 *
 * The mock camera and clock stand in for the phone, which is what lets the
 * entire flow — capture, chain, verify, report — be exercised in a browser.
 */
export function useInspection() {
  const clockRef = useRef(new MockClock(DEMO_JOB.inspectedAt, 90_000));
  const sessionRef = useRef<InspectionSession | null>(null);

  if (!sessionRef.current) {
    sessionRef.current = new InspectionSession(DEMO_JOB, {
      camera: new MockCamera(),
      location: new MockLocation({
        latitude: DEMO_JOB.propertyLocation!.latitude,
        longitude: DEMO_JOB.propertyLocation!.longitude,
        accuracyMetres: 6,
      }),
      clock: clockRef.current,
    });
  }

  const session = sessionRef.current;
  const [version, setVersion] = useState(0);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Re-verify whenever the package changes, so the badge always reflects what
  // is actually on screen rather than a stale pass.
  useEffect(() => {
    let cancelled = false;
    void session.verify().then((report) => {
      if (!cancelled) setIntegrity(report);
    });
    return () => {
      cancelled = true;
    };
  }, [session, version]);

  const addPhoto = useCallback(
    async (kind: "camera" | "library") => {
      setBusy(true);
      try {
        clockRef.current.advance();
        await session.addPhoto(kind);
        bump();
      } finally {
        setBusy(false);
      }
    },
    [session, bump],
  );

  const dictate = useCallback(
    async (text: string) => {
      const drafts = await structurer.structure(text);
      for (const draft of drafts) {
        session.addFinding({
          area: draft.area,
          description: draft.description,
          severity: draft.severity,
          evidenceIds: [],
        });
      }
      bump();
      return drafts.length;
    },
    [session, bump],
  );

  const attach = useCallback(
    (evidenceId: string, findingId: string) => {
      const finding = session.observations.find((f) => f.id === findingId);
      if (finding?.evidenceIds.includes(evidenceId)) session.detach(evidenceId, findingId);
      else session.attach(evidenceId, findingId);
      bump();
    },
    [session, bump],
  );

  const removeFinding = useCallback(
    (id: string) => {
      session.removeFinding(id);
      bump();
    },
    [session, bump],
  );

  const setCaption = useCallback(
    (evidenceId: string, caption: string) => {
      session.setCaption(evidenceId, caption);
      bump();
    },
    [session, bump],
  );

  const downloadReport = useCallback(async () => {
    const bytes = await session.renderPdf();
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${session.job.claimNumber}-report.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }, [session]);

  const captions = useMemo(
    () => new Map(session.notes.map((n) => [n.evidenceId, n.caption ?? ""])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, version],
  );

  return {
    job: session.job,
    evidence: session.evidence,
    findings: session.observations,
    imageFor: (id: string) => session.imageFor(id),
    captions,
    integrity,
    busy,
    addPhoto,
    dictate,
    attach,
    removeFinding,
    setCaption,
    downloadReport,
  };
}
