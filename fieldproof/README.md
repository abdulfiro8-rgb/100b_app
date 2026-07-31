# Fieldproof

On-site claim and inspection reports, finished before you leave the property —
with a chain of custody that holds up when the photographs are disputed.

## Why

An independent adjuster photographs a property with a phone and paper notes,
then spends 2–4 hours that evening at a laptop writing the report, while
handling 5–10 claims a day in catastrophe season. Fieldproof collapses that into
the walkthrough itself.

The differentiator is not the report; it is that the evidence behind it can be
checked. Claims photographs get challenged, and a report that cannot answer
"how do I know this file is what you took that day?" is worth very little.

## What the integrity check does and does not prove

This matters enough to state before anything else, because overstating it would
actively harm the person relying on it.

**It establishes:**
- The photographs are byte-for-byte identical to those recorded at the inspection.
- Capture details — time, location, order, source — have not been edited since.
- No photograph has been inserted into or removed from the middle of the sequence.

**It does not establish:**
- That a photograph depicts the property it is filed against.
- That the device's clock was set correctly.
- That the reported location was genuine; software can spoof GPS.
- That the image reached the app from the camera rather than another source.

So the product says **tamper-evident chain of custody from capture**, never
"tamper-proof". The same wording appears in the app and in the PDF appendix, so
the limits travel with the report rather than living on a marketing page.

Two hardening steps would raise that ceiling and the record layout leaves room
for both: RFC 3161 trusted timestamping, to anchor "recorded before time T" to
something other than the device clock, and Play Integrity / App Attest, to
establish the app itself was genuine.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 — mock camera, no device needed
npm test           # 47 tests
npm run typecheck
npm run build
```

The dev build runs against a mock camera and clock, so the whole flow — capture,
chain, verify, generate the PDF — works in a desktop browser with no phone, no
permissions and no GPS.

## Architecture

The part that only runs on a phone is kept as small as possible; everything else
is pure and testable anywhere.

```
src/core/       pure and deterministic
  chain.ts      hash chain over immutable capture facts
  provenance.ts location, clock and source checks
  verify.ts     re-hashes files, produces the integrity report
  report.ts     derives the report's structure
  pdf.ts        renders it, deterministically
  session.ts    one inspection in progress
src/capture/    the seam to the phone — CameraSource, LocationSource, Clock
src/ai/         the seam to speech and language models
  rules.ts      rules-based structurer: no API key, no network, no inference cost
src/ui/         React, mobile-first
```

Two design decisions worth knowing:

**Mutable data stays out of the chain.** Only immutable capture facts are hashed.
Captions and findings are written and rewritten after the inspection, which is
ordinary work — chaining them would make normal editing trip the tamper alarm. A
verifier that cries wolf on honest work gets switched off, and then it protects
nobody.

**Evidence is append-only.** There is no delete button for a photograph. Removing
one would produce exactly the gap the chain exists to expose, so evidence that
turns out to be irrelevant is left in place and simply not attached to a finding.

**Clock tampering is caught by recording two clocks.** The wall clock can be set
to anything; the monotonic clock cannot be wound backwards. When the two
disagree about how much time passed between two photographs, the wall clock was
changed. An app restart resets the monotonic origin, and that case is excluded
rather than reported as tampering.

## What the tests check

The adversarial cases are the point:

- Editing a photograph's bytes fails verification and names the file.
- Patching a single record's own hash still breaks the chain at the next link.
- Deleting or reordering records is detected, by both the broken link and the
  sequence gap.
- A chain lifted from another job fails, because the genesis link binds it.
- A photograph 800 m away is flagged; one 300 m away with ±150 m accuracy is not,
  because GPS uncertainty is charged against the distance first.
- A device clock wound forward mid-inspection is caught; an app restart is not
  mistaken for it.
- A library import is distinguished from a live capture.
- **An untouched package verifies clean, with no false alarms.** This is the most
  important test in the suite.
- The PDF is byte-identical when regenerated, so the report's own hash means
  something.

## Status and limitations

Slice 1 is complete: evidence chain, provenance, verification, findings, PDF and
the web app. Not yet built: live transcription or any LLM call, trusted
timestamping, device attestation, Xactimate (ESX) interchange, sync, billing, and
the native iOS/Android builds.

The AI seam ships a rules-based structurer that parses dictated notes on device.
It handles the common dictation shape — name the area once, then keep talking —
and deliberately never invents a severity that was not stated, falling back to
the least claim-inflating value and flagging it for review.

**Xactimate (Verisk) owns estimating and is not displaceable.** Fieldproof is the
documentation layer beside it, not a competitor to it.
