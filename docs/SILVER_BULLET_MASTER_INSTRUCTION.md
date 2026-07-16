# PERMANENT INSTRUCTION — ICT Silver Bullet Module (source of truth)

> Before any task involving the ICT Silver Bullet module (09:00 NY reference candle, 10:00–11:00
> execution window, sweeps, MSS/CISD, FVG/IFVG/Breaker/OB entries, SB logging/UI/backtesting or
> Gemini SB interpretation), read this file, `knowledge/user_rules/silver_bullet_rules.json` and
> the existing CRT/session rules first. User-approved rules outrank repository assumptions.

## Strategy profile (the ONLY profile implemented; variants need new profile ids)
```
setup_family      = ICT_SILVER_BULLET
strategy_profile  = NY_AM_09_HOURLY_RANGE_REVERSAL_V1
reference candle  = 09:00–10:00 America/New_York H1 (built from intraday bars, locked at 10:00)
execution window  = 10:00–11:00 America/New_York (entry must FILL before 11:00)
execution TF      = finest available intraday series (M1 preferred; M5 with Yahoo data)
primary markets   = NQ/NAS100 (ES when available); other symbols only via config
```

## Valid sequence (any mandatory piece missing → NO_TRADE)
```
VALID 09:00 REFERENCE RANGE → 10:00–11:00 WINDOW → MEANINGFUL SWEEP → FAILURE TO ACCEPT OUTSIDE
→ RECLAIM → DISPLACEMENT → MSS OR CISD → VALID FVG/IFVG/BREAKER/OB → ENTRY FILLED BEFORE 11:00
→ VALID STOP → AVAILABLE TARGET → ACCEPTABLE R:R
```
- High sweep ≠ automatic short; low sweep ≠ automatic long — failure to accept + reclaim required.
- BREAK_ACCEPTED_OUTSIDE (multiple closes outside / continuation) → reject the reversal setup.
- BOTH_SIDES_SWEPT before entry → reject by default.
- 11:00 NY: cancel unfilled orders, expire developing setups, mark NO_TRADE / LATE days.
- One filled SB trade per symbol per trading day (configurable).

## Time rules
America/New_York for all boundaries (IANA, DST-safe — never fixed UTC offsets). Timestamps stored
UTC; NY local time preserved for auditing. Reference candle validated for missing/duplicate bars;
incomplete data → no valid reference (NO_TRADE). Lock at 10:00; never repaint with later candles.

## Detectors
- **Sweep**: penetration distance/ATR ratio, closes outside count, time outside, reclaim timestamp.
- **Reclaim**: configurable method (default: M5 close back inside). **Acceptance**: ≥2 closes
  outside or displacement away → reversal rejected.
- **Displacement**: measurable — body/range ≥ 0.70, body vs ATR ≥ 1.5× (reference-repo initial
  values; configurable), close near extreme, FVG created.
- **MSS**: post-sweep counter-structure pivot broken by a displacement CLOSE; store pivot ts,
  break ts, confirmation ts — never hindsight-only pivots.
- **CISD** (explicit project definition, separate from MSS): for a bearish setup, the close back
  through the OPEN of the candle series that delivered up into the sweep (series origin open =
  CISD level); bullish inverse. Confirmed on candle close; stores level + source candles.
- **Entry arrays**: FVG (min gap 0.3×ATR, created by the confirmation displacement, entry on
  retracement into the zone) — IFVG/Breaker/OB reserved for later versions with their own strict
  definitions; never a bare "last opposite candle".
- Trigger priority (configurable): MSS+FVG → CISD+FVG.

## Trade plan
Stop = sweep extreme ± buffer (default 0.25×ATR). Targets: TP1 = reference midpoint, TP2 =
opposite reference extreme (evaluate deliverability — already-reached target → NO_TRADE).
Min R:R default 2.5 (reference-repo initial value; configurable). BE policy default: at 3R
(configuration-driven; time alone never triggers BE).

## Direction context
HTF bias is **BIAS_SCORED** by default (never a silent hard gate): agreement adds score, conflict
subtracts and is displayed. Record 1D/4H/1H bias, PDH/PDL, premium/discount.

## Scoring (0–100, explainable; configurable starting weights)
range quality 10 · sweep 15 · reclaim 10 · displacement 15 · MSS/CISD 15 · entry array 10 ·
HTF 10 · target 5 · RR 5 · timing 5. Penalties: both-sides, weak reclaim, closes outside, weak
displacement, stale zone, entry near 11:00, target partially delivered, HTF conflict,
expanded/exhausted range, news uncertainty, bad data. Grades: 85+ A+, 75+ A, 65+ B, 50+ C, else
Reject.

## Labels / lifecycle / logging
`setup_model`: NY_AM_09_RANGE_HIGH_SWEEP_BEARISH_SB | NY_AM_09_RANGE_LOW_SWEEP_BULLISH_SB.
Trigger labels: SB_MSS_FVG, SB_CISD_FVG (+future array types). Lifecycle: the §9 state machine
(PRE_REFERENCE … NO_TRADE/COMPLETED) — never a bare boolean. Logs live in namespace
`SILVER_BULLET_SETUP` with lifecycle event types, idempotent (symbol+tradingDay+profile+direction+
referenceRangeId+sweepEventId+triggerType); no generic CRT/session log pollution.

## Gemini
Interpret-only (§33 instruction), structured JSON (§34 schema), backend-only key. Validation
rejects: invalid JSON, invented event ids/prices/sweeps/MSS/CISD, **approval of a post-11:00
entry**, missing contradictions/invalidation, unsupported strategy profile. Knowledge retrieval:
3–8 relevant concept records only.

## Reference repos (references/, gitignored)
Silver-Bullet-AM-Session (primary; NO LICENSE → REFERENCE ONLY, parameters as initial values:
ATR_DISPLACEMENT 1.5×, BODY_RATIO 0.70, FVG 0.3×ATR, MIN_RR 2.5, BE 3R, risk 1%) ·
ict-knowledge-library (concepts/Gemini) · smart-money-concepts (detector reference; beware
future-candle pivots) · model-trader (architecture) · OpenMobius-skill (RAG grounding) ·
market calendars (exchange schedule vs ICT window are SEPARATE concepts) · tzdata · python-genai.

## Permanent learning
Maintain docs/SILVER_BULLET_{RULES,ARCHITECTURE,CHANGELOG}.md +
knowledge/user_rules/silver_bullet_rules.json + knowledge/strategies/ny_am_09_range_v1.json.
When the user teaches an SB rule: convert to objective rule → save → update docs/tests →
changelog. Never silently forget approved rules.
