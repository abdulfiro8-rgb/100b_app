# Milestamp

Automatic mileage tracking that doesn't drain your battery, priced at the rate
the IRS actually had in force on the day you drove.

Everything runs on the device. No account, no server, no subscription to a
company that can raise the price 50% next year.

## Why this exists

Two things are wrong with the incumbents:

**Battery.** MileIQ and Everlance both poll GPS continuously, and battery drain
is the most common complaint against both. The alternative is to idle on
low-power OS signals — iOS significant-location-change, visit monitoring and
`CMMotionActivity`; Android `ActivityRecognition` — and only wake full GPS once
the OS says you are actually in a vehicle. Same automatic tracking, a fraction
of the power. This is a measured claim waiting to be measured: see
[docs/mobile.md](docs/mobile.md).

**Correctness.** The IRS raised the business mileage rate *mid-year* in 2026:
72.5¢ through 30 June, 76¢ from 1 July. Any app applying a single annual rate
produces a wrong number on a tax return. Milestamp prices every trip at the rate
in force on its own date and shows the split.

## Status

Phase 1 (the pure core plus the web app) is complete and tested. Native
detection and store builds are not — see [docs/mobile.md](docs/mobile.md) for
what remains and what cannot be verified from a Linux container.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173, seeded with a synthetic year
npm test           # 47 tests
npm run typecheck
npm run build
```

The dev build is seeded with a year of synthetic trips that straddle the 2026
rate change, so the reports have something real to show without a phone.

## Architecture

The design goal is that the part which can only run on a phone is as small as
possible, and everything else is testable anywhere.

```
src/core/       pure, deterministic, no platform dependencies
  geo.ts        haversine distance
  segment.ts    location stream -> trips
  rates.ts      date-ranged IRS rate table + deduction arithmetic
  classify.ts   categories and auto-rules
  report.ts     year summary, IRS-style log, CSV export
src/detect/     the seam to native code
  types.ts      DriveDetector interface
  mock.ts       replays traces — lets the whole app run with no device
  recorder.ts   live sample stream -> completed trips
src/ui/         React components
```

`DriveDetector` is the only interface a native implementation has to satisfy.
Everything downstream consumes `LocationSample` and neither knows nor cares
whether it came from a motion coprocessor or a recorded trace.

## What the tests actually check

The interesting tests are the adversarial ones, because they are the failure
modes that make a mileage log fall apart under audit:

- **Phantom miles.** A car parked for eight hours produces no trip. Summing
  haversine across stationary GPS jitter invents miles out of noise.
- **Tunnels.** A drive through four minutes of lost signal stays one trip, not
  three. Elapsed time alone cannot distinguish a tunnel from a car park — the
  discriminator is whether fixes kept *arriving*.
- **Flights.** A 167 m/s leg is rejected rather than deducted, while the drive
  to the airport is kept.
- **The rate boundary.** A trip on 30 June is priced at 72.5¢ and one on 1 July
  at 76¢, using the timezone captured at trip start — so a 23:30 drive on 30
  June is not silently repriced because it is already July in UTC.
- **Year totals.** The annual figure equals the sum of per-trip deductions, and
  explicitly not `total_miles × one_rate`, which overstates 2026 by $7 per 400
  business miles.
- **Streaming equals batch.** Trips detected live from a sample stream are
  identical to those produced by segmenting the whole trace at once.

## Deliberate limitations

- **No sync and no backup.** Data lives in device storage. That is the privacy
  position and the reason there is no backend to pay for, but it means export
  is the user's responsibility before switching devices.
- **Trips start as personal.** Nothing is auto-promoted into a deduction.
  Guessing in favour of the taxpayer is the wrong default when the number lands
  on a return.
- **Rates end where the table ends.** Asking for a date with no published rate
  throws rather than returning zero — a silent zero understates a deduction with
  no visible signal.
- This is a mileage record, not tax advice.

## Rate sources

| Period | Business | Medical/Moving | Charity | Source |
| --- | --- | --- | --- | --- |
| 2026-07-01 – 2026-12-31 | 76¢ | 23.5¢ | 14¢ | Midyear increase |
| 2026-01-01 – 2026-06-30 | 72.5¢ | 20.5¢ | 14¢ | Notice 2026-10 |
| 2025 | 70¢ | 21¢ | 14¢ | Notice 2025-05 |
| 2024 | 67¢ | 21¢ | 14¢ | Notice 2024-08 |
| 2023 | 65.5¢ | 22¢ | 14¢ | Notice 2023-03 |
| 2022-07-01 – 2022-12-31 | 62.5¢ | 22¢ | 14¢ | Announcement 2022-13 |
| 2022-01-01 – 2022-06-30 | 58.5¢ | 18¢ | 14¢ | Notice 2022-03 |

The charitable rate is fixed at 14¢ by statute (26 U.S.C. §170(i)) and is never
inflation-adjusted.
