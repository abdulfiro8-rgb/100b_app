import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { INTEGRITY_STATEMENT } from "./verify.js";
import { SEVERITY_LABELS, type ReportModel, type ReportPhoto } from "./report.js";

/**
 * Renders a report to PDF.
 *
 * Output is deterministic: identical input produces byte-identical output. That
 * matters here beyond tidiness — if regenerating a report produced a different
 * file each time, the file's own hash would be useless as a reference, and
 * "this is not the report I sent you" becomes unanswerable. pdf-lib stamps
 * creation and modification dates by default, so both are pinned explicitly.
 */

const LETTER: [number, number] = [612, 792];
const MARGIN = 54;
const INK = rgb(0.06, 0.07, 0.1);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ALERT = rgb(0.72, 0.16, 0.16);
const GOOD = rgb(0.05, 0.5, 0.34);

/** Fixed epoch for document metadata, so output does not vary with the clock. */
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function renderReportPdf(
  model: ReportModel,
  images: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(model.title);
  doc.setSubject(`Claim ${model.claimNumber} — ${model.propertyAddress}`);
  // Producer is not set here: pdf-lib overwrites it with its own value on save.
  doc.setCreator("Fieldproof");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const cursor = new Cursor(doc, fonts);

  drawCover(cursor, model);
  drawFindings(cursor, model, images);
  await drawPhotos(cursor, model, images);
  drawIntegrityAppendix(cursor, model);

  return doc.save();
}

/**
 * Sequential layout cursor.
 *
 * pdf-lib has no flow layout, so page breaks are managed explicitly: ask for
 * vertical space before drawing, and get a fresh page when the current one runs
 * out.
 */
class Cursor {
  page: PDFPage;
  y: number;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }

  get width(): number {
    return LETTER[0] - MARGIN * 2;
  }

  newPage(): void {
    this.page = this.doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }

  /** Ensures `needed` points remain, breaking the page if not. */
  reserve(needed: number): void {
    if (this.y - needed < MARGIN) this.newPage();
  }

  text(
    value: string,
    options: { size?: number; bold?: boolean; colour?: ReturnType<typeof rgb>; gap?: number } = {},
  ): void {
    const { size = 10, bold = false, colour = INK, gap = 4 } = options;
    const font = bold ? this.fonts.bold : this.fonts.regular;

    for (const line of wrap(value, font, size, this.width)) {
      this.reserve(size + gap);
      this.y -= size;
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: colour });
      this.y -= gap;
    }
  }

  rule(gap = 10): void {
    this.reserve(gap * 2);
    this.y -= gap;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + this.width, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= gap;
  }

  space(amount: number): void {
    this.y -= amount;
  }
}

function drawCover(cursor: Cursor, model: ReportModel): void {
  cursor.text("INSPECTION REPORT", { size: 9, bold: true, colour: MUTED, gap: 10 });
  cursor.text(model.claimNumber, { size: 24, bold: true, gap: 6 });
  cursor.text(model.propertyAddress, { size: 12, colour: MUTED, gap: 14 });

  cursor.rule();

  const rows: Array<[string, string]> = [
    ["Insured", model.insuredName],
    ["Policy", model.policyNumber],
    ["Peril", model.perilLabel],
    ["Inspected", model.inspectedAtLocal],
    ["Inspector", `${model.inspectorName} (${model.inspectorLicense})`],
    ["Photographs", String(model.photoCount)],
  ];

  for (const [label, value] of rows) {
    cursor.reserve(16);
    cursor.y -= 11;
    cursor.page.drawText(label, {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: cursor.fonts.regular,
      color: MUTED,
    });
    cursor.page.drawText(value, {
      x: MARGIN + 110,
      y: cursor.y,
      size: 10,
      font: cursor.fonts.bold,
      color: INK,
    });
    cursor.y -= 5;
  }

  cursor.rule();

  const intact = model.integrity.integrity === "intact";
  cursor.text(
    intact
      ? `Evidence integrity: verified — ${model.integrity.contentVerified} of ${model.integrity.recordCount} photographs match their capture records.`
      : `Evidence integrity: FAILED — see the appendix. This report should not be relied upon until the discrepancies are resolved.`,
    { size: 10, bold: true, colour: intact ? GOOD : ALERT, gap: 6 },
  );

  if (model.unconfirmedSeverities > 0) {
    cursor.text(
      `${model.unconfirmedSeverities} finding(s) have a severity nobody confirmed; they are shown as provisional.`,
      { size: 9, colour: ALERT },
    );
  }

  if (model.integrity.provenanceIssues.length > 0) {
    cursor.text(
      `${model.integrity.provenanceIssues.length} provenance note(s) recorded — see the appendix.`,
      { size: 9, colour: MUTED },
    );
  }
}

function drawFindings(
  cursor: Cursor,
  model: ReportModel,
  _images: ReadonlyMap<string, Uint8Array>,
): void {
  cursor.newPage();
  cursor.text("Findings", { size: 16, bold: true, gap: 10 });

  if (model.areas.length === 0) {
    cursor.text("No findings were recorded for this inspection.", { colour: MUTED });
    return;
  }

  for (const area of model.areas) {
    cursor.reserve(48);
    cursor.space(8);
    cursor.text(area.area, { size: 12, bold: true, gap: 6 });

    for (const finding of area.findings) {
      const grade = finding.severityStated
        ? SEVERITY_LABELS[finding.severity]
        : `${SEVERITY_LABELS[finding.severity]} (unconfirmed)`;
      cursor.text(`${grade} — ${finding.description}`, {
        size: 10,
        colour: finding.severityStated ? INK : ALERT,
        gap: 4,
      });

      if (finding.photos.length > 0) {
        const refs = finding.photos.map((p) => `Photo ${p.sequence + 1}`).join(", ");
        cursor.text(refs, { size: 9, colour: MUTED, gap: 8 });
      }
    }
    cursor.rule(6);
  }
}

async function drawPhotos(
  cursor: Cursor,
  model: ReportModel,
  images: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const all = [...model.areas.flatMap((a) => a.findings.flatMap((f) => f.photos)), ...model.unattached];
  if (all.length === 0) return;

  cursor.newPage();
  cursor.text("Photographs", { size: 16, bold: true, gap: 12 });

  for (const photo of all) {
    await drawPhoto(cursor, photo, images.get(photo.evidenceId));
  }
}

async function drawPhoto(
  cursor: Cursor,
  photo: ReportPhoto,
  bytes: Uint8Array | undefined,
): Promise<void> {
  cursor.reserve(230);
  cursor.space(6);
  cursor.text(`Photo ${photo.sequence + 1}${photo.caption ? ` — ${photo.caption}` : ""}`, {
    size: 10,
    bold: true,
    gap: 6,
  });

  if (bytes) {
    const doc = cursor.page.doc;
    // Only PNG and JPEG are embeddable; anything else is recorded as evidence
    // but cannot be shown inline.
    const embedded = isPng(bytes)
      ? await doc.embedPng(bytes)
      : isJpeg(bytes)
        ? await doc.embedJpg(bytes)
        : undefined;

    if (embedded) {
      const maxWidth = Math.min(cursor.width, 320);
      const maxHeight = 180;
      const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height, 1);
      const w = embedded.width * scale;
      const h = embedded.height * scale;

      cursor.reserve(h + 8);
      cursor.y -= h;
      cursor.page.drawImage(embedded, { x: MARGIN, y: cursor.y, width: w, height: h });
      cursor.y -= 8;
    }
  } else {
    cursor.text("[image file not available]", { size: 9, colour: ALERT, gap: 4 });
  }

  cursor.text(`${photo.capturedAtLocal} · ${photo.locationText} · ${photo.sourceText}`, {
    size: 8,
    colour: MUTED,
    gap: 4,
  });

  for (const note of photo.notes) {
    cursor.text(`Note: ${note.detail}`, {
      size: 8,
      colour: note.level === "critical" ? ALERT : MUTED,
      gap: 3,
    });
  }

  cursor.rule(6);
}

function drawIntegrityAppendix(cursor: Cursor, model: ReportModel): void {
  cursor.newPage();
  cursor.text("Appendix — evidence integrity", { size: 16, bold: true, gap: 12 });

  cursor.text("What this check establishes", { size: 11, bold: true, gap: 6 });
  for (const line of INTEGRITY_STATEMENT.establishes) {
    cursor.text(`•  ${line}`, { size: 9, gap: 4 });
  }

  cursor.space(8);
  cursor.text("What this check does not establish", { size: 11, bold: true, gap: 6 });
  for (const line of INTEGRITY_STATEMENT.doesNotEstablish) {
    cursor.text(`•  ${line}`, { size: 9, colour: MUTED, gap: 4 });
  }

  cursor.rule();

  const { integrity } = model;
  cursor.text(
    `Result: chain ${integrity.integrity}, ${integrity.contentVerified} of ${integrity.recordCount} photographs verified.`,
    { size: 10, bold: true, gap: 8 },
  );

  const problems = [
    ...integrity.chainIssues.map((i) => `Chain — ${i.evidenceId}: ${i.detail}`),
    ...integrity.contentIssues.map((i) => `Content — ${i.evidenceId}: ${i.detail}`),
    ...integrity.provenanceIssues.map((i) => `Provenance (${i.level}) — ${i.evidenceId}: ${i.detail}`),
  ];

  if (problems.length === 0) {
    cursor.text("No discrepancies were found.", { size: 9, colour: MUTED });
    return;
  }

  for (const problem of problems) {
    cursor.text(`•  ${problem}`, { size: 9, gap: 4 });
  }
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Greedy word wrap against the embedded font's real metrics. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}
