import { useEffect, useState } from "react";
import { IDLE, type DictationController, type DictationState } from "../ai/dictation.js";

interface Props {
  controller: DictationController | null;
  onFindings: (transcript: string) => Promise<unknown>;
}

/**
 * Microphone control and transcript.
 *
 * The transcript stays editable before findings are created: recognisers
 * mishear trade vocabulary constantly, and an adjuster who cannot fix "shingers"
 * before it reaches the report will stop using dictation entirely.
 */
export function DictatePanel({ controller, onFindings }: Props) {
  const [state, setState] = useState<DictationState>(controller?.current ?? IDLE);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!controller) return;
    setState(controller.current);
    return controller.subscribe(setState);
  }, [controller]);

  const supported = controller?.isAvailable() ?? false;
  // Typing is always available; dictation is the accelerator, not the gate.
  const text = state.transcript || typed;

  return (
    <section className="card">
      <h2>Findings</h2>
      <p className="sub">
        Say the area once, then keep talking. Notes are turned into findings on this device — no
        network, no API key.
      </p>

      {supported && controller && (
        <>
          <button
            type="button"
            className={`button${state.listening ? " listening" : ""}`}
            onClick={() => (state.listening ? void controller.stop() : void controller.start())}
          >
            {state.listening ? "◼  Stop dictating" : "●  Dictate"}
          </button>

          {/* Load-bearing, not small print: this app promises evidence stays on
              the device, and spoken notes about a claim are not trivial. */}
          <p className="hint">
            {controller.isOnDevice
              ? "Speech is recognised on this device."
              : "Speech recognition uses your platform's service, which may send audio off this device. Type instead if the claim is sensitive."}
          </p>
        </>
      )}

      {!supported && (
        <p className="hint" style={{ marginTop: 0 }}>
          No speech recognition available here — type the notes instead.
        </p>
      )}

      {state.error && <div className="notice error">{state.error.message}</div>}

      <textarea
        value={state.partial ? `${text} ${state.partial}`.trim() : text}
        placeholder="Roof. Lifted shingles along the ridge, moderate. Also cracked flashing at the chimney."
        onChange={(event) => {
          if (controller && state.transcript) controller.setTranscript(event.target.value);
          else setTyped(event.target.value);
        }}
        style={state.listening ? { borderColor: "var(--accent)" } : undefined}
      />

      {state.partial && (
        <p className="hint" style={{ marginTop: -4 }}>
          Listening… the greyed phrase is still being revised and is not saved yet.
        </p>
      )}

      <button
        type="button"
        className="button"
        disabled={!text.trim() || state.listening}
        onClick={async () => {
          await onFindings(text);
          controller?.clear();
          setTyped("");
        }}
      >
        Add findings
      </button>
    </section>
  );
}
