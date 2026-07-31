import type { Severity } from "../core/types.js";

/**
 * The seam to speech and language models.
 *
 * Nothing downstream knows whether findings came from a language model, an
 * on-device Whisper build or the rules engine in `rules.ts`. That is deliberate:
 * the first release ships the rules engine, so the product works with no API
 * key, no network and no per-user inference cost, and a model can be swapped in
 * later without touching the evidence or reporting code.
 */

export interface Transcriber {
  readonly name: string;
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

/** A proposed finding, before a human accepts it. */
export interface DraftFinding {
  area: string;
  description: string;
  severity: Severity;
  /**
   * Whether the dictation actually stated a severity.
   *
   * When it did not, the draft falls back to the least claim-inflating value
   * and marks it for review. Inventing a severity would put a number on a claim
   * that nobody said out loud.
   */
  severityStated: boolean;
}

export interface Structurer {
  readonly name: string;
  structure(text: string, knownAreas?: readonly string[]): Promise<DraftFinding[]>;
}
