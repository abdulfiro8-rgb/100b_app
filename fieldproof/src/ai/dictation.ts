import { RulesStructurer } from "./rules.js";
import type { DictationError, DictationSource, DraftFinding, Structurer } from "./types.js";

export interface DictationState {
  listening: boolean;
  /** Text the recogniser has settled on so far. */
  transcript: string;
  /** The phrase currently being revised. Shown live, never committed. */
  partial: string;
  error: DictationError | null;
}

export const IDLE: DictationState = {
  listening: false,
  transcript: "",
  partial: "",
  error: null,
};

/**
 * Turns a recogniser stream into draft findings.
 *
 * Sits between `DictationSource` and `Structurer` so the rule that matters is
 * in one testable place: **only final results become text**. Partial results
 * are the recogniser thinking aloud — it revises them freely, and "severe" can
 * become "several" a word later. Committing them would put words into an
 * adjuster's report that they never said.
 */
export class DictationController {
  private state: DictationState = IDLE;
  private readonly subscribers = new Set<(state: DictationState) => void>();

  constructor(
    private readonly source: DictationSource,
    private readonly structurer: Structurer = new RulesStructurer(),
  ) {}

  get current(): DictationState {
    return this.state;
  }

  get isOnDevice(): boolean {
    return this.source.isOnDevice;
  }

  get sourceName(): string {
    return this.source.name;
  }

  isAvailable(): boolean {
    return this.source.isAvailable();
  }

  subscribe(listener: (state: DictationState) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async start(): Promise<void> {
    this.update({ listening: true, error: null, partial: "" });

    await this.source.start({
      onPartial: (text) => this.update({ partial: text }),
      onFinal: (text) => {
        const transcript = this.state.transcript
          ? `${this.state.transcript} ${text}`.replace(/\s+/g, " ")
          : text;
        this.update({ transcript, partial: "" });
      },
      onError: (error) => this.update({ error, listening: false, partial: "" }),
      onEnd: () => this.update({ listening: false, partial: "" }),
    });
  }

  async stop(): Promise<void> {
    await this.source.stop();
    this.update({ listening: false, partial: "" });
  }

  /** Lets a user correct the recogniser before findings are created. */
  setTranscript(transcript: string): void {
    this.update({ transcript });
  }

  /** Structures the settled transcript. Partial text is deliberately excluded. */
  async toFindings(knownAreas: readonly string[] = []): Promise<DraftFinding[]> {
    const text = this.state.transcript.trim();
    if (!text) return [];
    return this.structurer.structure(text, knownAreas);
  }

  clear(): void {
    this.state = IDLE;
    this.publish();
  }

  private update(patch: Partial<DictationState>): void {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  private publish(): void {
    for (const listener of this.subscribers) listener(this.state);
  }
}
