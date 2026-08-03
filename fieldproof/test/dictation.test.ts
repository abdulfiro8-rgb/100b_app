import { describe, expect, it } from "vitest";
import { DictationController } from "../src/ai/dictation.js";
import { ScriptedDictation } from "../src/ai/mock.js";
import type { DictationState } from "../src/ai/dictation.js";

function controller(lines: Array<{ text: string; final: boolean }>, isOnDevice = true) {
  return new DictationController(new ScriptedDictation(lines, isOnDevice));
}

describe("what becomes text", () => {
  it("keeps only final results", async () => {
    // Recognisers revise interim guesses freely — "severe" can become "several"
    // a word later. Committing partials would put words in the report that
    // nobody said.
    const c = controller([
      { text: "Roof north", final: false },
      { text: "Roof north slope", final: false },
      { text: "Roof north slope. Lifted shingles, moderate.", final: true },
    ]);

    await c.start();

    expect(c.current.transcript).toBe("Roof north slope. Lifted shingles, moderate.");
    expect(c.current.partial).toBe("");
  });

  it("joins successive final phrases", async () => {
    const c = controller([
      { text: "Roof. Lifted shingles, moderate.", final: true },
      { text: "Kitchen: ceiling staining, minor.", final: true },
    ]);

    await c.start();
    expect(c.current.transcript).toBe(
      "Roof. Lifted shingles, moderate. Kitchen: ceiling staining, minor.",
    );
  });

  it("exposes the phrase in progress without committing it", async () => {
    const seen: DictationState[] = [];
    const c = controller([{ text: "Roof nor", final: false }]);
    c.subscribe((state) => seen.push({ ...state }));

    await c.start();

    expect(seen.some((s) => s.partial === "Roof nor")).toBe(true);
    expect(c.current.transcript).toBe("");
  });
});

describe("speech to findings", () => {
  it("runs the settled transcript through the structurer", async () => {
    const c = controller([
      { text: "Roof north slope. Wind lifted shingles along the ridge, moderate.", final: true },
      { text: "Kitchen: water staining to the ceiling, minor.", final: true },
    ]);

    await c.start();
    const drafts = await c.toFindings();

    // "Roof north slope" only names the area, so it carries forward rather than
    // becoming a finding of its own.
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.area)).toEqual(["Roof North Slope", "Kitchen"]);
    expect(drafts[0]!.severity).toBe("moderate");
    expect(drafts[1]!.severity).toBe("minor");
  });

  it("produces nothing from partials alone", async () => {
    const c = controller([{ text: "Roof. Lifted shingles", final: false }]);
    await c.start();
    expect(await c.toFindings()).toEqual([]);
  });

  it("lets the user correct the recogniser before creating findings", async () => {
    // Recognisers mishear trade terms constantly; the transcript has to be
    // editable or the findings inherit every mistake.
    const c = controller([{ text: "Roof. Lifted shingers, moderate.", final: true }]);
    await c.start();

    c.setTranscript("Roof. Lifted shingles, moderate.");
    const drafts = await c.toFindings();

    expect(drafts[0]!.description).toContain("Lifted shingles");
  });
});

describe("failure", () => {
  it("surfaces a permission refusal rather than failing silently", async () => {
    const source = new ScriptedDictation([], true, {
      code: "permission-denied",
      message: "Microphone access was refused.",
    });
    const c = new DictationController(source);

    await c.start();

    expect(c.current.error?.code).toBe("permission-denied");
    expect(c.current.listening).toBe(false);
  });

  it("stops listening when the recogniser ends on its own", async () => {
    const c = controller([{ text: "Roof.", final: true }]);
    await c.start();
    expect(c.current.listening).toBe(false);
  });

  it("clears back to idle", async () => {
    const c = controller([{ text: "Roof.", final: true }]);
    await c.start();
    c.clear();
    expect(c.current).toEqual({ listening: false, transcript: "", partial: "", error: null });
  });
});

describe("honesty about where audio goes", () => {
  it("reports whether the source keeps audio on the device", async () => {
    // The UI reads this to tell the user which promise applies. A source that
    // sends audio away must say so.
    expect(controller([], true).isOnDevice).toBe(true);
    expect(controller([], false).isOnDevice).toBe(false);
  });
});
