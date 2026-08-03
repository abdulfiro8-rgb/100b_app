import type { EvidenceAnnotation, EvidenceRecord, Finding, Job } from "../core/types.js";

/**
 * On-device storage.
 *
 * IndexedDB rather than `localStorage`: photographs are binary and a
 * catastrophe season's worth of them is orders of magnitude past a 5 MB string
 * quota.
 *
 * Storage is treated as untrusted. Records are read back exactly as written and
 * their hashes are **never** recomputed on load — if a row is corrupted, dropped
 * or edited on disk, verification must report it. Rehydrating by recalculating
 * hashes would quietly repair the damage and hand back a package that looks
 * pristine, which is the one failure this product cannot afford.
 */

const DB_NAME = "fieldproof";
const DB_VERSION = 1;

const JOBS = "jobs";
const RECORDS = "records";
const IMAGES = "images";
const ANNOTATIONS = "annotations";
const FINDINGS = "findings";

export interface StoredInspection {
  job: Job;
  records: EvidenceRecord[];
  annotations: EvidenceAnnotation[];
  findings: Finding[];
  images: Map<string, Uint8Array>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RECORDS)) {
        db.createObjectStore(RECORDS, { keyPath: "id" }).createIndex("jobId", "jobId");
      }
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        db.createObjectStore(ANNOTATIONS, { keyPath: "evidenceId" });
      }
      if (!db.objectStoreNames.contains(FINDINGS)) {
        db.createObjectStore(FINDINGS, { keyPath: "id" }).createIndex("jobId", "jobId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listJobs(): Promise<Job[]> {
  const db = await open();
  const jobs = await toPromise(db.transaction(JOBS, "readonly").objectStore(JOBS).getAll());
  db.close();
  return (jobs as Job[]).sort((a, b) => b.inspectedAt - a.inspectedAt);
}

export async function saveJob(job: Job): Promise<void> {
  const db = await open();
  const tx = db.transaction(JOBS, "readwrite");
  tx.objectStore(JOBS).put(job);
  await done(tx);
  db.close();
}

export async function deleteJob(jobId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([JOBS, RECORDS, IMAGES, FINDINGS], "readwrite");

  tx.objectStore(JOBS).delete(jobId);

  // Cascade by hand: IndexedDB has no foreign keys, and orphaned evidence would
  // otherwise accumulate invisibly against the device's storage quota.
  const recordIndex = tx.objectStore(RECORDS).index("jobId");
  const cursorRequest = recordIndex.openCursor(IDBKeyRange.only(jobId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    tx.objectStore(IMAGES).delete((cursor.value as EvidenceRecord).id);
    cursor.delete();
    cursor.continue();
  };

  const findingCursor = tx.objectStore(FINDINGS).index("jobId").openCursor(IDBKeyRange.only(jobId));
  findingCursor.onsuccess = () => {
    const cursor = findingCursor.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };

  await done(tx);
  db.close();
}

/** Appends one record and its bytes. Evidence is never updated in place. */
export async function appendEvidence(record: EvidenceRecord, bytes: Uint8Array): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDS, IMAGES], "readwrite");
  tx.objectStore(RECORDS).put(record);
  // Copied into a plain ArrayBuffer: structured clone of a typed-array view can
  // otherwise carry the whole backing buffer along with it.
  tx.objectStore(IMAGES).put(bytes.slice().buffer, record.id);
  await done(tx);
  db.close();
}

export async function saveAnnotation(annotation: EvidenceAnnotation): Promise<void> {
  const db = await open();
  const tx = db.transaction(ANNOTATIONS, "readwrite");
  tx.objectStore(ANNOTATIONS).put(annotation);
  await done(tx);
  db.close();
}

export async function saveFindings(jobId: string, findings: readonly Finding[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(FINDINGS, "readwrite");
  const store = tx.objectStore(FINDINGS);

  const existing = await toPromise(store.index("jobId").getAllKeys(IDBKeyRange.only(jobId)));
  for (const key of existing) store.delete(key);
  for (const finding of findings) store.put({ ...finding, jobId });

  await done(tx);
  db.close();
}

/** Loads an inspection exactly as stored, with no hashes recomputed. */
export async function loadInspection(jobId: string): Promise<StoredInspection | undefined> {
  const db = await open();
  const tx = db.transaction([JOBS, RECORDS, IMAGES, ANNOTATIONS, FINDINGS], "readonly");

  const job = (await toPromise(tx.objectStore(JOBS).get(jobId))) as Job | undefined;
  if (!job) {
    db.close();
    return undefined;
  }

  const records = (await toPromise(
    tx.objectStore(RECORDS).index("jobId").getAll(IDBKeyRange.only(jobId)),
  )) as EvidenceRecord[];
  records.sort((a, b) => a.sequence - b.sequence);

  const images = new Map<string, Uint8Array>();
  for (const record of records) {
    const buffer = (await toPromise(tx.objectStore(IMAGES).get(record.id))) as
      | ArrayBuffer
      | undefined;
    if (buffer) images.set(record.id, new Uint8Array(buffer));
  }

  const allAnnotations = (await toPromise(
    tx.objectStore(ANNOTATIONS).getAll(),
  )) as EvidenceAnnotation[];
  const ids = new Set(records.map((r) => r.id));

  const findings = (await toPromise(
    tx.objectStore(FINDINGS).index("jobId").getAll(IDBKeyRange.only(jobId)),
  )) as Array<Finding & { jobId?: string }>;

  db.close();

  return {
    job,
    records,
    images,
    annotations: allAnnotations.filter((a) => ids.has(a.evidenceId)),
    findings: findings.map(({ jobId: _ignored, ...finding }) => finding),
  };
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([JOBS, RECORDS, IMAGES, ANNOTATIONS, FINDINGS], "readwrite");
  for (const store of [JOBS, RECORDS, IMAGES, ANNOTATIONS, FINDINGS]) {
    tx.objectStore(store).clear();
  }
  await done(tx);
  db.close();
}
