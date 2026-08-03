import type { DictationError, DictationHandlers, DictationSource } from "./types.js";

/**
 * Browser speech recognition.
 *
 * **Audio leaves the device.** Chrome's implementation streams to Google's
 * speech service; it is not local, whatever the rest of this app does. That is
 * why `isOnDevice` is false and why the UI says so at the microphone rather
 * than in small print. On a phone the native recogniser is used instead and can
 * keep audio local — see `nativespeech.ts`.
 */
export class WebSpeechDictation implements DictationSource {
  readonly name = "browser";
  readonly isOnDevice = false;

  private recognition: SpeechRecognition | undefined;
  private stopping = false;

  isAvailable(): boolean {
    return getConstructor() !== undefined;
  }

  async start(handlers: DictationHandlers): Promise<void> {
    const Recognition = getConstructor();
    if (!Recognition) {
      handlers.onError({
        code: "unsupported",
        message: "This browser has no speech recognition. Type the notes instead.",
      });
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      // The event carries every result since the session began, so only the
      // ones from `resultIndex` are new.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (!text.trim()) continue;

        if (result.isFinal) handlers.onFinal(text.trim());
        else handlers.onPartial(text.trim());
      }
    };

    recognition.onerror = (event) => {
      // A no-speech timeout while the user is thinking is not worth an alarm.
      if (this.stopping && event.error === "aborted") return;
      handlers.onError(translate(event.error));
    };

    recognition.onend = () => {
      this.recognition = undefined;
      handlers.onEnd?.();
    };

    this.recognition = recognition;
    this.stopping = false;
    recognition.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.recognition?.stop();
    this.recognition = undefined;
  }
}

type RecognitionConstructor = new () => SpeechRecognition;

function getConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  // Still vendor-prefixed in Chrome and Safari despite being typed unprefixed.
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function translate(error: string): DictationError {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: "permission-denied",
        message: "Microphone access was refused. Allow it, or type the notes instead.",
      };
    case "no-speech":
      return { code: "no-speech", message: "Nothing was heard. Try again, closer to the mic." };
    case "network":
      return {
        code: "network",
        message: "Speech recognition needs a connection in this browser and could not reach it.",
      };
    case "aborted":
      return { code: "aborted", message: "Dictation stopped." };
    default:
      return { code: "unknown", message: `Speech recognition failed (${error}).` };
  }
}
