import { describe, expect, it } from "vitest";
import { RulesStructurer } from "../src/ai/rules.js";

const structurer = new RulesStructurer();

describe("dictation to draft findings", () => {
  it("pulls the area off a labelled segment", async () => {
    const [finding] = await structurer.structure("Kitchen: water staining on the ceiling, minor");

    expect(finding).toMatchObject({
      area: "Kitchen",
      severity: "minor",
      severityStated: true,
    });
    // The adjuster's own wording is preserved rather than paraphrased, with
    // only the leading capital normalised.
    expect(finding!.description).toBe("Water staining on the ceiling, minor");
  });

  it("carries the area forward across following sentences", async () => {
    // How people actually dictate: name the room once, then keep talking.
    const findings = await structurer.structure(
      "Roof. Lifted shingles along the ridge, moderate. Also cracked flashing at the chimney.",
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.area)).toEqual(["Roof", "Roof"]);
    expect(findings[1]!.description).toBe("Cracked flashing at the chimney");
  });

  it("switches area when a new one is named", async () => {
    const findings = await structurer.structure(
      "Garage: oil staining on the slab. Basement: standing water, severe.",
    );

    expect(findings.map((f) => f.area)).toEqual(["Garage", "Basement"]);
    expect(findings[1]!.severity).toBe("severe");
  });

  it("understands the prepositional form", async () => {
    const [finding] = await structurer.structure(
      "In the bathroom, the extractor fan housing is cracked",
    );
    expect(finding!.area).toBe("Bathroom");
  });

  it("recognises each severity word", async () => {
    const cases: Array<[string, string]> = [
      ["Roof: shingles scuffed, cosmetic", "minor"],
      ["Roof: shingles lifted, moderate", "moderate"],
      ["Roof: decking exposed, extensive", "severe"],
      ["Roof: structure destroyed", "total"],
    ];

    for (const [text, expected] of cases) {
      const [finding] = await structurer.structure(text);
      expect(finding!.severity).toBe(expected);
    }
  });

  it("does not invent a severity that was never stated", async () => {
    // Putting a number on a claim nobody said out loud is the wrong kind of
    // helpful, so it falls back to the least inflating value and flags itself.
    const [finding] = await structurer.structure("Kitchen: cabinet doors swollen at the base");

    expect(finding!.severityStated).toBe(false);
    expect(finding!.severity).toBe("minor");
  });

  it("accepts custom areas supplied by the job", async () => {
    const findings = await structurer.structure("Pool house: ceiling sagging, severe", [
      "Pool house",
    ]);
    expect(findings[0]!.area).toBe("Pool House");
  });

  it("files unattributed notes under Unspecified rather than guessing", async () => {
    const [finding] = await structurer.structure("Something is dripping somewhere");
    expect(finding!.area).toBe("Unspecified");
  });

  it("returns nothing for empty dictation", async () => {
    expect(await structurer.structure("   \n  ")).toEqual([]);
  });
});
