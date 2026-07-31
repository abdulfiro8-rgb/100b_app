import type { Severity } from "../core/types.js";
import type { DraftFinding, Structurer } from "./types.js";

/**
 * Turns dictated notes into draft findings using rules rather than a model.
 *
 * Deterministic, instant, free, and works on a roof with no signal — which
 * covers the common case well enough to ship without an inference bill. A
 * model implementing the same `Structurer` interface can replace it for messier
 * dictation without anything else changing.
 */

const AREA_VOCABULARY = [
  "roof",
  "attic",
  "ceiling",
  "kitchen",
  "bathroom",
  "bedroom",
  "living room",
  "dining room",
  "garage",
  "basement",
  "crawl space",
  "exterior",
  "siding",
  "foundation",
  "fence",
  "gutter",
  "gutters",
  "window",
  "windows",
  "door",
  "doors",
  "deck",
  "patio",
  "driveway",
  "shed",
  "hallway",
  "stairs",
  "laundry",
  "porch",
];

const SEVERITY_PATTERNS: Array<[Severity, RegExp]> = [
  ["total", /\b(total loss|totall?ed|destroyed|beyond repair)\b/i],
  ["severe", /\b(severe|major|extensive|substantial|heavy)\b/i],
  ["moderate", /\b(moderate|noticeable)\b/i],
  ["minor", /\b(minor|light|slight|cosmetic|superficial)\b/i],
];

export class RulesStructurer implements Structurer {
  readonly name = "rules";

  async structure(text: string, knownAreas: readonly string[] = []): Promise<DraftFinding[]> {
    const vocabulary = [...knownAreas.map((a) => a.toLowerCase()), ...AREA_VOCABULARY];
    const findings: DraftFinding[] = [];

    // Dictation runs on: "Roof north slope. Lifted shingles, moderate. Also
    // cracked flashing." The area is stated once and then implied, so the last
    // one seen carries forward until another is named.
    let currentArea = "";

    for (const segment of splitSegments(text)) {
      const { area, remainder } = extractArea(segment, vocabulary);
      if (area) currentArea = area;

      const description = tidy(remainder);
      if (!description) continue;

      const stated = detectSeverity(segment);

      findings.push({
        area: currentArea || "Unspecified",
        description,
        severity: stated ?? "minor",
        severityStated: stated !== undefined,
      });
    }

    return findings;
  }
}

/** Splits on sentence and clause boundaries, keeping short fragments intact. */
function splitSegments(text: string): string[] {
  return text
    .split(/(?:[.;\n]+)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Pulls an area name off the front of a segment.
 *
 * Handles the three shapes people actually dictate: "Kitchen: ...",
 * "Kitchen — ...", and "In the kitchen, ...".
 */
function extractArea(
  segment: string,
  vocabulary: readonly string[],
): { area: string; remainder: string } {
  const labelled = segment.match(/^\s*([^:—-]{2,40})\s*[:—-]\s*(.+)$/);
  if (labelled) {
    const candidate = labelled[1]!.trim();
    if (mentionsArea(candidate, vocabulary)) {
      return { area: titleCase(candidate), remainder: labelled[2]! };
    }
  }

  const prepositional = segment.match(/^\s*(?:in|on|at)\s+the\s+([a-z\s]{2,30}?)\s*[,:]\s*(.+)$/i);
  if (prepositional && mentionsArea(prepositional[1]!, vocabulary)) {
    return { area: titleCase(prepositional[1]!.trim()), remainder: prepositional[2]! };
  }

  // A segment that is only an area name announces the area for what follows.
  if (mentionsArea(segment, vocabulary) && segment.split(/\s+/).length <= 4) {
    return { area: titleCase(segment.trim()), remainder: "" };
  }

  return { area: "", remainder: segment };
}

function mentionsArea(text: string, vocabulary: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return vocabulary.some((term) => new RegExp(`\\b${escape(term)}\\b`).test(lower));
}

function detectSeverity(segment: string): Severity | undefined {
  for (const [severity, pattern] of SEVERITY_PATTERNS) {
    if (pattern.test(segment)) return severity;
  }
  return undefined;
}

function tidy(text: string): string {
  const cleaned = text
    .replace(/^\s*(?:also|and|then)\b[,\s]*/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();

  return cleaned ? cleaned[0]!.toUpperCase() + cleaned.slice(1) : "";
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
