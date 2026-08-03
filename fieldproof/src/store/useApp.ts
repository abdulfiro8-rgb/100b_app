import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { InspectionSession } from "../core/session.js";
import { MockCamera, MockLocation } from "../capture/mock.js";
import { systemClock, type CaptureDeps } from "../capture/types.js";
import { RulesStructurer } from "../ai/rules.js";
import { packageFileName, writePackage } from "../core/package.js";
import * as db from "./db.js";
import type { IntegrityReport } from "../core/verify.js";
import type { Job, Peril } from "../core/types.js";

const structurer = new RulesStructurer();

/**
 * Chooses real capture on a device and fixtures in a browser.
 *
 * The seam in `capture/types.ts` is what makes this a one-line decision:
 * everything downstream consumes the same `CapturedImage` either way. The
 * Capacitor plugins are imported lazily so a browser never loads native shims
 * it cannot use.
 */
async function makeDeps(fallbackLocation: Job["propertyLocation"]): Promise<CaptureDeps> {
  if (Capacitor.isNativePlatform()) {
    const { DeviceCamera, DeviceLocation } = await import("../capture/capacitor.js");
    return { camera: new DeviceCamera(), location: new DeviceLocation(), clock: systemClock };
  }

  return {
    camera: new MockCamera(),
    location: new MockLocation(
      fallbackLocation ? { ...fallbackLocation, accuracyMetres: 6 } : undefined,
    ),
    // The real clock even in the browser demo, so timestamps and the monotonic
    // cross-check behave exactly as they will on a phone.
    clock: systemClock,
  };
}

export interface NewJobInput {
  claimNumber: string;
  insuredName: string;
  propertyAddress: string;
  peril: Peril;
  inspectorName: string;
}

export function useApp() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  const sessionRef = useRef<InspectionSession | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    void db.listJobs().then((stored) => {
      setJobs(stored);
      setLoading(false);
    });
  }, []);

  // Load the active job's evidence from storage. Records are adopted exactly as
  // stored — see `InspectionSession.hydrate` for why nothing is recomputed.
  useEffect(() => {
    if (!activeJobId) {
      sessionRef.current = null;
      setIntegrity(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const stored = await db.loadInspection(activeJobId);
      if (!stored || cancelled) return;
      const deps = await makeDeps(stored.job.propertyLocation);
      sessionRef.current = InspectionSession.hydrate(stored.job, deps, stored);
      bump();
    })();

    return () => {
      cancelled = true;
    };
  }, [activeJobId, bump]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    let cancelled = false;
    void session.verify().then((report) => {
      if (!cancelled) setIntegrity(report);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const createJob = useCallback(async (input: NewJobInput) => {
    const job: Job = {
      id: `job-${Date.now()}`,
      claimNumber: input.claimNumber,
      peril: input.peril,
      insuredName: input.insuredName,
      propertyAddress: input.propertyAddress,
      // A real build geocodes the address here; the demo anchors to a fixed
      // point so the distance checks have something to measure against.
      propertyLocation: { latitude: 29.7604, longitude: -95.3698 },
      inspectorName: input.inspectorName,
      inspectedAt: Date.now(),
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    };

    await db.saveJob(job);
    setJobs(await db.listJobs());
    setActiveJobId(job.id);
    return job;
  }, []);

  const deleteJob = useCallback(
    async (jobId: string) => {
      await db.deleteJob(jobId);
      setJobs(await db.listJobs());
      if (activeJobId === jobId) setActiveJobId(null);
    },
    [activeJobId],
  );

  const addPhoto = useCallback(
    async (kind: "camera" | "library") => {
      const session = sessionRef.current;
      if (!session) return;

      setBusy(true);
      try {
        const record = await session.addPhoto(kind);
        // Written through immediately: an inspector who loses signal, battery
        // or the app between photographs must not lose the evidence.
        await db.appendEvidence(record, session.imageFor(record.id)!);
        bump();
      } finally {
        setBusy(false);
      }
    },
    [bump],
  );

  const dictate = useCallback(
    async (text: string) => {
      const session = sessionRef.current;
      if (!session) return 0;

      const drafts = await structurer.structure(text);
      for (const draft of drafts) {
        session.addFinding({
          area: draft.area,
          description: draft.description,
          severity: draft.severity,
          evidenceIds: [],
        });
      }
      await db.saveFindings(session.job.id, session.observations);
      bump();
      return drafts.length;
    },
    [bump],
  );

  const attach = useCallback(
    async (evidenceId: string, findingId: string) => {
      const session = sessionRef.current;
      if (!session) return;

      const finding = session.observations.find((f) => f.id === findingId);
      if (finding?.evidenceIds.includes(evidenceId)) session.detach(evidenceId, findingId);
      else session.attach(evidenceId, findingId);

      await db.saveFindings(session.job.id, session.observations);
      bump();
    },
    [bump],
  );

  const removeFinding = useCallback(
    async (id: string) => {
      const session = sessionRef.current;
      if (!session) return;
      session.removeFinding(id);
      await db.saveFindings(session.job.id, session.observations);
      bump();
    },
    [bump],
  );

  const downloadReport = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    download(
      await session.renderPdf(),
      "application/pdf",
      `${session.job.claimNumber}-report.pdf`,
    );
  }, []);

  const exportPackage = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const bytes = writePackage(session.toPackage(), session.files);
    download(bytes, "application/zip", packageFileName(session.job));
  }, []);

  const session = sessionRef.current;

  return {
    loading,
    jobs,
    activeJob: session?.job ?? null,
    activeJobId,
    setActiveJobId,
    createJob,
    deleteJob,
    evidence: session?.evidence ?? [],
    findings: session?.observations ?? [],
    imageFor: (id: string) => session?.imageFor(id),
    integrity,
    busy,
    addPhoto,
    dictate,
    attach,
    removeFinding,
    downloadReport,
    exportPackage,
  };
}

function download(bytes: Uint8Array, mimeType: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
