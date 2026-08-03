import type { DictationError, DictationHandlers, DictationSource } from "./types.js";

export interface ScriptedLine {
  text: string;
  /** Partial results are interim guesses and must never become findings. */
  final: boolean;
}

/**
 * A scripted recogniser.
 *
 * Real speech recognition needs a microphone, which a test runner and a
 * headless browser do not have. This drives the identical code path — partial
 * handling, finals, errors, stop — so everything between the microphone and a
 * persisted finding is covered without one.
 */
export class ScriptedDictation implements DictationSource {
  readonly name = "scripted";

  private running = false;

  constructor(
    private readonly lines: readonly ScriptedLine[],
    readonly isOnDevice = true,
    private readonly failWith?: DictationError,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async start(handlers: DictationHandlers): Promise<void> {
    this.running = true;

    if (this.failWith) {
      handlers.onError(this.failWith);
      this.running = false;
      handlers.onEnd?.();
      return;
    }

    for (const line of this.lines) {
      if (!this.running) break;
      if (line.final) handlers.onFinal(line.text);
      else handlers.onPartial(line.text);
    }

    this.running = false;
    handlers.onEnd?.();
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
