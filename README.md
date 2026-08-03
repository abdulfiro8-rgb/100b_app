# 100b_app

Two apps, built from a conversation about what is worth building.

| | |
| --- | --- |
| [**fieldproof/**](fieldproof) | On-site claim and inspection reports with a verifiable chain of custody. For independent insurance adjusters and inspectors. |
| [**./** (Milestamp)](#milestamp) | Automatic mileage tracking without the battery drain, priced at the IRS rate actually in force on the day. |

Both run entirely on the device. No account, no server, no subscription that can
be repriced next year.

---

## Fieldproof

An adjuster photographs a property with a phone and paper notes, then spends
2–4 hours that evening writing the report — while handling 5–10 claims a day in
catastrophe season. Fieldproof produces the report before they leave.

The differentiator is that the evidence behind it can be checked. Every
photograph is hashed at capture and linked to the one before it, and export
produces a `.fpx` package an examiner can verify with nothing but `unzip` and
`sha256sum`.

**What the integrity check does and does not prove** is stated in the app, in the
PDF appendix and in the package README — it says *tamper-evident chain of custody
from capture*, never "tamper-proof". A hash chain cannot prove a photograph
depicts the property, that the clock was honest, or that GPS was not spoofed.

94 tests. See [fieldproof/README.md](fieldproof/README.md).

```bash
cd fieldproof && npm install && npm run dev
```

## Milestamp

MileIQ raised prices 50% in 2026 and battery drain is the top complaint against
both it and Everlance, which poll GPS continuously. Milestamp idles on low-power
OS signals and wakes GPS only once the OS reports vehicle motion.

The second wedge is correctness: the IRS raised the business mileage rate
*mid-year* in 2026 (72.5¢ through 30 June, 76¢ from 1 July), so any app applying
a single annual rate produces a wrong number on a tax return. Milestamp prices
every trip at the rate in force on its own date.

47 tests. Phase 1 (the pure core and the web app) is complete; the low-power
detection is a **measured hypothesis, not a measured fact** — see
[docs/mobile.md](docs/mobile.md) for the battery harness that has to run first.

```bash
npm install && npm run dev
```

## What neither app has

Distribution. Both are products, not businesses: no billing, no store presence,
no users. For Fieldproof in particular — a B2B tool sold to independent adjusters
— getting in front of buyers is the harder half of the work and none of it is
done.

The iOS projects are configured but **have never been compiled**: that needs
macOS and Xcode, and this was built on Linux.
