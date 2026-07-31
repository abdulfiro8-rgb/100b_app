import { useCallback, useEffect, useMemo, useState } from "react";
import { seedTrips } from "../demo/seed.js";
import type { Trip, TripCategory } from "../core/types.js";

const STORAGE_KEY = "milestamp.trips.v1";
const MANUAL_KEY = "milestamp.manual.v1";

interface Persisted {
  trips: Trip[];
  /** IDs the user classified by hand, so auto-rules never overwrite them. */
  manual: string[];
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const manualRaw = localStorage.getItem(MANUAL_KEY);
    if (raw) {
      return {
        trips: JSON.parse(raw) as Trip[],
        manual: manualRaw ? (JSON.parse(manualRaw) as string[]) : [],
      };
    }
  } catch {
    // Corrupt storage should not wedge the app on launch.
  }
  return { trips: seedTrips(), manual: [] };
}

/**
 * Trip store.
 *
 * Everything lives in `localStorage` on the device. There is no account, no
 * sync and no server to send a year of someone's movements to — which is both
 * the privacy position and the reason the app has no backend to pay for.
 */
export function useTrips() {
  const [state, setState] = useState<Persisted>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
      localStorage.setItem(MANUAL_KEY, JSON.stringify(state.manual));
    } catch {
      // Quota exceeded: keep running with in-memory state rather than crashing.
    }
  }, [state]);

  const classify = useCallback((id: string, category: TripCategory) => {
    setState((prev) => ({
      trips: prev.trips.map((t) => (t.id === id ? { ...t, category } : t)),
      manual: prev.manual.includes(id) ? prev.manual : [...prev.manual, id],
    }));
  }, []);

  const setPurpose = useCallback((id: string, purpose: string) => {
    setState((prev) => ({
      ...prev,
      trips: prev.trips.map((t) => (t.id === id ? { ...t, purpose } : t)),
    }));
  }, []);

  const addTrips = useCallback((incoming: Trip[]) => {
    setState((prev) => {
      const known = new Set(prev.trips.map((t) => t.id));
      const fresh = incoming.filter((t) => !known.has(t.id));
      if (fresh.length === 0) return prev;
      return {
        ...prev,
        trips: [...fresh, ...prev.trips].sort((a, b) => b.startedAt - a.startedAt),
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState({ trips: seedTrips(), manual: [] });
  }, []);

  const years = useMemo(() => {
    const set = new Set(state.trips.map((t) => new Date(t.startedAt).getUTCFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [state.trips]);

  return {
    trips: state.trips,
    manual: state.manual,
    years,
    classify,
    setPurpose,
    addTrips,
    reset,
  };
}
