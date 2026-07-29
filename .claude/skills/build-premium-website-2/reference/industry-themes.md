# Industry Themes — v2 (Editorial Publication)

Map the user's industry to (a) a suggested accent color and (b) the split-flap label mapping. Both are overridable at intake — this table is the default when the user says "auto".

## Accent + Split-flap labels

| Industry | Accent hex | Split-flap columns |
|---|---|---|
| Finance / audit / accounting | Ink blue `#1F3A5F` | `Vol · Issue · Practice · Status` values cycle `XII/04/AUDIT/OPEN → XII/04/BRIEF/ACT → XII/05/MATCH/WARM → XII/05/PLACE/CLOSE` |
| Legal / notarial / M&A | Ink blue `#1F3A5F` | `Vol · Docket · Matter · Status` |
| Recruitment / executive search | Ink blue `#1F3A5F` | `Vol · Issue · Section · Status` |
| Advisory / consulting | Ochre `#B58A2E` | `Year · Sprint · Engage · Phase` |
| Publishing / editorial / arts | Rust `#B45A3C` | `Vol · Issue · Section · State` |
| Hospitality / restaurant | Terracotta `#C56A4A` | `Menu · Course · Season · Service` |
| Wellness / spa | Burgundy `#7A2E2E` | `Suite · Booking · Ritual · State` |
| Fashion / gallery / luxury | Charcoal `#2A2A2A` | `Season · Look · Gallery · Status` |
| Real estate / architecture | Forest `#2F4A3A` | `Portfolio · Plot · Stage · Status` |
| Interior design / studio | Rust `#B45A3C` | `Studio · Room · Project · Stage` |
| Tech / SaaS / product | Ink blue `#1F3A5F` | `Release · Build · Feature · State` |
| Fitness / gym | Rust `#B45A3C` | `Season · Block · Focus · State` |
| Bakery / cafe / food | Terracotta `#C56A4A` | `Batch · Loaf · Bake · Serve` |
| Landscaping / garden | Forest `#2F4A3A` | `Season · Plot · Bloom · State` |
| Auto / mechanic | Charcoal `#2A2A2A` | `Bay · Job · Stage · Ready` |
| Construction | Ochre `#B58A2E` | `Project · Phase · Trade · Stage` |
| Plumbing / electrical / HVAC | Ink blue `#1F3A5F` | `Route · Call · Trade · Status` |
| Beauty / salon | Burgundy `#7A2E2E` | `Chair · Booking · Service · State` |

## How to invent a mapping (industry not in table)

Pick two "process" nouns (larger → smaller unit of work; e.g. `Project · Phase`), one "practice / discipline" noun (`Trade`, `Section`, `Matter`), and one "state" noun (`Status`, `Stage`, `State`). Then invent 4–5 value cycles that tell a mini-story of the service.

## Marquee tokens

Marquee band content = uppercase service keywords joined by `●`. Pull directly from the 6 services from intake; add 3–5 supporting words. Example (recruitment):

```
EXECUTIVE SEARCH ● FINANCE ● AUDIT ● TAX ● TRANSFER PRICING ● LEGAL ● NOTARIAL ● INTERIM ● CAREER ADVISORY ● HUMAN TO HUMAN ● SINCE 2013 ● AMSTERDAM
```

Keep tokens 1–3 words. All uppercase in the mono font.
