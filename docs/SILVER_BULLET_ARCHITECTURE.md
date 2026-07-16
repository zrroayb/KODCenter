# Silver Bullet — Architecture & Phase-1 Audit (2026-07-16)

## Audit (§42)

**Reusable modules (no rebuild):**
- `sessionClock.tzOffsetHours` — IANA/DST-safe NY-time math (used by 4H NY-close candles already).
- `structureEngine.detectFairValueGaps / detectSwingPoints` — FVG + pivots (pivots use a right
  wing → live confirmation delay respected by storing confirmation timestamps).
- `bidAsk.executable*` — NaN-guarded executable prices.
- `sessionRangeEngine` / `sessionConfluenceEngine` patterns — stateful ranges, setup objects,
  score breakdowns, store reconcile (`sessionSetupStore`), SessionSetupsView UI shell.
- `crtInterpretation`/worker Gemini proxy pattern — structured output + validation, backend key.
- MarketContext biases (1D/4H/1H), premiumDiscount, liquidityObjectives (PDH/PDL).

**Existing functionality that is NOT the SB model (kept separate):**
- CRT anchors, killzone confluence, session confluence setups — different families; SB gets its
  own `ICT_SILVER_BULLET` family, states, logs, UI section.

**Missing (built in this module):**
- 09:00 NY H1 reference builder with data-quality validation + lock semantics.
- 10:00–11:00 window state machine (sweep metrics, reclaim vs acceptance, both-sides, late).
- CISD detector — audited: none existed anywhere in the project → explicit definition written
  (close through the origin OPEN of the pre-reversal delivery series), implemented with tests.
- SB scoring/grades, NO_TRADE reasons, idempotency, separate SILVER_BULLET_SETUP logs.
- Gemini SB endpoint (system instruction §33 + response schema §34 + post-11:00 veto validation).
- Silver Bullet section in the Session Setups tab.

**Risks & mitigations:**
- *Lookahead*: reference locked at 10:00, only candles ≤ now are consumed, MSS pivots need a
  confirmed right wing, entry fill uses candles after the zone forms. No future-candle access.
- *Repaint*: locked reference never recalculated; sweep/reclaim events keep first timestamps.
- *DST*: all boundaries via tzOffsetHours("America/New_York") — tested across Jan/Jul dates.
- *Data*: Yahoo M1 unavailable reliably → execution runs on M5 (12 bars per reference hour,
  validated; `expectedBars` configurable). M1 support is a config change, not a rewrite.
- *Duplicates*: deterministic idempotency key + store reconcile (same pattern as session module).
- *Exchange schedule*: ICT window vs exchange calendar kept as separate concepts; incomplete
  reference data (holiday/early close) → INVALID reference → NO_TRADE.

## Architecture
```
m5 candles (MarketContext)
  → buildSilverBulletReferenceRange (09:00–10:00 NY, validated, locked)
  → evaluateSilverBullet (window engine: sweep → reclaim/acceptance → displacement → MSS/CISD
     → FVG entry array → fill-before-11:00 → stop/targets/RR → score/grade → lifecycle + logs)
  → SilverBulletSetup (+ SILVER_BULLET_SETUP logs, idempotent)
  → silverBulletStore (persist + reconcile)
  → SessionSetupsView ▸ Silver Bullet section
  → /api/gemini/silver-bullet-analysis (interpret-only, validated)
```

**Files created:** `src/lib/strategies/silverBullet/{types,referenceRange,silverBulletEngine,
silverBulletStore}.ts`, `src/lib/gemini/silverBulletInterpretation.ts`, tests
(`silverBulletReference/silverBulletEngine/silverBulletGemini`), governance docs + knowledge.
**Files modified:** `vite.config.ts`, `worker/index.ts` (endpoint), `src/App.tsx`,
`src/components/SessionSetupsView.tsx` (section), `src/styles.css`.
