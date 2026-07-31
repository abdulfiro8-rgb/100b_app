# Shipping to iOS and Android

The web app is the same codebase that ships to both stores, wrapped with
Capacitor. This document records what is done, what is left, and — importantly —
what cannot be done from this development container.

## Current state

- `capacitor.config.ts` is configured for a fully bundled app (no remote URL).
- `@capacitor/core` and `@capacitor/cli` are installed.
- Native projects have **not** been generated yet. Once the platform packages
  are added:

```bash
npm install @capacitor/android @capacitor/ios
npm run build
npx cap add android
npx cap add ios       # requires macOS
npx cap sync
```

## What cannot be verified here

**iOS cannot be built or tested in this container.** Compiling an iOS app
requires macOS and Xcode; this environment is Linux. The Swift detection plugin
can be written here, but it is unverified code until it is compiled on a Mac.
For an app whose core value is native background behaviour, treat the iOS half
as unproven until then.

Battery measurements — the entire premise of the product — likewise require real
hardware. See "Phase 0" below.

## Phase 0: validate the premise before building further

The differentiator is the claim that drives can be detected without continuous
GPS polling. It is a well-founded hypothesis, not yet a measured fact. Before
investing in the rest of the mobile app, build a bare harness that:

1. Logs battery drain over a fixed period using continuous `FusedLocationProvider`
   / `CLLocationManager` updates (the incumbent approach).
2. Logs battery drain over the same period using the low-power path below.
3. Confirms the low-power path does not *miss* drives — a tracker that saves
   battery by losing trips is worthless, since users cannot deduct what was
   never recorded.

If (1) and (2) come out close, the wedge is gone and the product needs to
compete on price and correctness alone. Better to learn that in days.

## The low-power detection strategy

### iOS

- `CLLocationManager.startMonitoringSignificantLocationChanges()` — cell/Wi-Fi
  based, wakes the app on meaningful movement, negligible battery cost.
- `startMonitoringVisits()` — the OS reports arrivals and departures directly,
  which maps almost exactly onto trip start/end.
- `CMMotionActivityManager` — the motion coprocessor reports `automotive` with
  a confidence level, without waking the main CPU.
- Full GPS (`startUpdatingLocation` with `desiredAccuracy` tuned) is started
  **only** once automotive activity is confirmed, and stopped as soon as it ends.

Requires `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSMotionUsageDescription`,
and the `location` background mode.

### Android

- `ActivityRecognitionClient` with `IN_VEHICLE` transitions (Google Play
  Services, free) as the wake signal.
- `FusedLocationProviderClient` at high accuracy only while a drive is active,
  inside a foreground service with `foregroundServiceType="location"`.
- The service must handle being killed: persist the in-progress trip's samples
  so a restart resumes rather than losing the drive.

Requires `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
`ACTIVITY_RECOGNITION`, `FOREGROUND_SERVICE_LOCATION`.

The plugin implements `DriveDetector` (`src/detect/types.ts`), so everything
downstream is unchanged and stays testable without a device.

## Store submission

These need a person, not a build script:

- Apple Developer Program — $99/year. Google Play Console — $25 one-time.
- Signing certificates and keystores.
- **Background location is the most scrutinised permission on both stores.**
  Google Play requires a written declaration plus a video demonstrating why
  `ACCESS_BACKGROUND_LOCATION` is necessary; Apple reviews "Always" location
  carefully. Budget for this being the slowest part of shipping, not the code.
- Guideline 4.2 (minimum functionality) rejects thin website wrappers. The
  native file/share integrations are what make this a real app rather than a
  bookmark.

## Monetisation

A backend-free app cannot gate a paywall on the web — there is no server, and
client-side gating is trivially bypassed. StoreKit and Play Billing *are* the
entitlement server, which is what makes the mobile builds the commercial
product and the web app the funnel.

Positioning follows from the market: MileIQ raised prices 50% in 2026 to
$8.99/month and Everlance Professional is $99.99/year, both with battery
complaints. A flat, low, one-time-or-cheap price aimed at that frustration is
the opening.
