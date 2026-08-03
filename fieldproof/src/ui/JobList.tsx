import { useState } from "react";
import type { Job, Peril } from "../core/types.js";
import type { NewJobInput } from "../store/useApp.js";

const PERILS: Peril[] = ["wind", "hail", "water", "fire", "flood", "impact", "theft", "other"];

interface Props {
  jobs: readonly Job[];
  onOpen: (jobId: string) => void;
  onCreate: (input: NewJobInput) => Promise<unknown>;
  onDelete: (jobId: string) => void;
}

export function JobList({ jobs, onOpen, onCreate, onDelete }: Props) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewJobInput>({
    claimNumber: "",
    insuredName: "",
    propertyAddress: "",
    peril: "wind",
    inspectorName: "",
  });

  const canSubmit = form.claimNumber.trim() && form.propertyAddress.trim();

  return (
    <>
      <section className="card">
        <h2>Inspections</h2>
        <p className="sub">
          Stored on this device. Photographs are hashed as they are taken and kept whether or not
          the app is open.
        </p>

        {jobs.length === 0 && <p className="empty">No inspections yet.</p>}

        {jobs.map((job) => (
          <div className="finding" key={job.id}>
            <div className="finding-top">
              <span className="finding-area">{job.claimNumber}</span>
              <span className="severity">{job.peril}</span>
            </div>
            <p className="finding-desc">{job.propertyAddress}</p>
            <div className="finding-photos">
              {job.insuredName} · {new Date(job.inspectedAt).toLocaleDateString()}
            </div>
            <div style={{ marginTop: 7, display: "flex", gap: 12 }}>
              <button type="button" className="link" onClick={() => onOpen(job.id)}>
                Open
              </button>
              <button type="button" className="link danger" onClick={() => onDelete(job.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>New inspection</h2>
        {!creating ? (
          <button type="button" className="button" onClick={() => setCreating(true)}>
            Start an inspection
          </button>
        ) : (
          <>
            <Field
              label="Claim number"
              value={form.claimNumber}
              onChange={(claimNumber) => setForm({ ...form, claimNumber })}
            />
            <Field
              label="Property address"
              value={form.propertyAddress}
              onChange={(propertyAddress) => setForm({ ...form, propertyAddress })}
            />
            <Field
              label="Insured"
              value={form.insuredName}
              onChange={(insuredName) => setForm({ ...form, insuredName })}
            />
            <Field
              label="Inspector"
              value={form.inspectorName}
              onChange={(inspectorName) => setForm({ ...form, inspectorName })}
            />

            <label className="field-label" htmlFor="peril">
              Peril
            </label>
            <select
              id="peril"
              className="purpose-input"
              value={form.peril}
              onChange={(event) => setForm({ ...form, peril: event.target.value as Peril })}
            >
              {PERILS.map((peril) => (
                <option key={peril} value={peril}>
                  {peril}
                </option>
              ))}
            </select>

            <div className="actions" style={{ marginTop: 11 }}>
              <button
                type="button"
                className="button"
                disabled={!canSubmit}
                onClick={async () => {
                  await onCreate(form);
                  setCreating(false);
                }}
              >
                Create
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="field-label" htmlFor={label}>
        {label}
      </label>
      <input
        id={label}
        className="purpose-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}
