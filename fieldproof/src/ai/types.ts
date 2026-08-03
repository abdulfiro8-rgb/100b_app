import type { Severity } from "../core/types.js";

/**
 * The seam to speech recognition and language models.
 *
 * Nothing downstream knows whether findings came from a recogniser, a language
 * model or the rules engine in `rules.ts`. That is deliberate: the app ships
 * with the rules engine, so it works with no API key, no network and no
 * per-user inference cost, and a model can be swapped in later without touching
 * the evidence or reporting code.
 */

/**
 * A live speech recogniser.
 *
 * Modelled as a listening session rather than `transcribe(audioFile)` because
 * the recognisers available for free on every platform are streaming: the
 * browser's `SpeechRecognition`, iOS `SFSpeechRecognizer` and Android
 * `SpeechRecognizer` all emit results as the person speaks. A file-based
 * interface would force buffering audio just to hand it back, and would lose
 * the partial results that make dictation feel responsive.
 */
export interface DictationSource {
  readonly name: string;

  /**
   * Whether audio stays on the device.
   *
   * Part of the interface rather than a footnote, because it is the difference
   * between two very different promises. Chrome's Web Speech implementation
   * streams audio to Google's servers; iOS and Android can recognise locally.
   * An app that tells adjusters their evidence never leaves the device must not
   * quietly ship their spoken notes about a claim to a third party — so the UI
   * reads this and says plainly which is happening.
   */
  readonly isOnDevice: boolean;

  isAvailable(): boolean;
  start(handlers: DictationHandlers): Promise<void>;
  stop(): Promise<void>;
}

export interface DictationHandlers {
  /** Interim text, still being revised. Never committed to a finding. */
  onPartial(text: string): void;
  /** Text the recogniser considers settled. */
  onFinal(text: string): void;
  onError(error: DictationError): void;
  /** Fired when the recogniser stops on its own, e.g. on a long silence. */
  onEnd?(): void;
}

export type DictationErrorCode =
  | "unsupported"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "aborted"
  | "unknown";

export interface DictationError {
  code: DictationErrorCode;
  /** Message shown to the user. Recognisers fail often; silence is not an option. */
  message: string;
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
