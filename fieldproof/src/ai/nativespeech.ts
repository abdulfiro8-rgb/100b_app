import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import type { PluginListenerHandle } from "@capacitor/core";
import type { DictationHandlers, DictationSource } from "./types.js";

/**
 * Speech recognition on a phone, via iOS `SFSpeechRecognizer` and Android
 * `SpeechRecognizer`.
 *
 * **`isOnDevice` is false, and that is not an oversight.** Both platforms *can*
 * recognise locally — iOS through `requiresOnDeviceRecognition`, Android when
 * offline language models are installed — but this plugin exposes neither
 * switch, so the request goes out with the platform default, which is
 * server-side. Claiming local recognition here would be a guess dressed as a
 * guarantee, on exactly the promise this product is sold on.
 *
 * Making it genuinely on-device means writing a small custom plugin that sets
 * those flags and reports back which mode it got. Until then the UI says audio
 * may be processed off-device, and an adjuster handling sensitive claims can
 * type instead.
 */
export class NativeSpeechDictation implements DictationSource {
  readonly name = "device";
  readonly isOnDevice = false;

  private listeners: PluginListenerHandle[] = [];
  private latest = "";
  private available: boolean | undefined;

  isAvailable(): boolean {
    // Synchronous by interface; the async probe result is cached by `probe()`.
    return this.available !== false;
  }

  /** Asks the platform whether a recogniser exists. Call once at start-up. */
  async probe(): Promise<boolean> {
    try {
      const { available } = await SpeechRecognition.available();
      this.available = available;
      return available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async start(handlers: DictationHandlers): Promise<void> {
    try {
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted") {
        handlers.onError({
          code: "permission-denied",
          message: "Microphone access was refused. Allow it, or type the notes instead.",
        });
        return;
      }

      this.latest = "";

      this.listeners.push(
        await SpeechRecognition.addListener("partialResults", ({ matches }) => {
          const text = matches?.[0]?.trim();
          if (!text) return;
          this.latest = text;
          handlers.onPartial(text);
        }),
      );

      this.listeners.push(
        await SpeechRecognition.addListener("listeningState", ({ status }) => {
          if (status !== "stopped") return;
          // With `partialResults` on, the plugin emits no separate final event:
          // recognition just ends. The last partial is the settled text, so it
          // is committed here rather than being dropped.
          if (this.latest) {
            handlers.onFinal(this.latest);
            this.latest = "";
          }
          handlers.onEnd?.();
        }),
      );

      await SpeechRecognition.start({
        partialResults: true,
        // The Android popup blocks partial results and takes over the screen —
        // wrong for someone holding a phone up at a roofline.
        popup: false,
        maxResults: 1,
      });
    } catch (cause) {
      handlers.onError({
        code: "unknown",
        message: `Speech recognition could not start (${String(cause)}).`,
      });
    }
  }

  async stop(): Promise<void> {
    try {
      await SpeechRecognition.stop();
    } finally {
      for (const listener of this.listeners) await listener.remove();
      this.listeners = [];
    }
  }
}
