# CRT Rules — User-Approved (human-readable)

Machine-readable source: [`knowledge/user_rules/crt_rules.json`](../knowledge/user_rules/crt_rules.json).
Governing framework: [`docs/CRT_MASTER_INSTRUCTION.md`](./CRT_MASTER_INSTRUCTION.md).

**User-approved rules have priority over repository assumptions and over any single latest
message.** Do not silently forget them.

## Timeframes & bias
- **Anchor mapping** — 4H→15m, 1D→1h, 1W→4h. Scan **all** anchors, not just 4H. *(implemented)*
- **HTF alignment (loose)** — only an *opposing* higher TF vetoes READY; a *neutral* higher TF is
  tolerated (costs score). Chain: 4H needs 1D+1W, 1D needs 1W, 1W needs 1M. *(implemented)*
- **Two-sided directional bias** — separate bullish/bearish scores in draw-first order (external
  draw → HTF structure → PD → sweep → displacement → LTF MSS → session), bullish if ≥65 & margin
  ≥15 else neutral; PD alone never forces direction. Surfaced as `directional-bias` evidence,
  flags contradictions; does not override per-anchor direction yet. *(implemented)*

## Location, sweep & confirmation
- **Raid lands at a POI** — swept level must coincide with a key level (PDH/PDL/PWH/PWL) or HTF
  FVG; a random wick isn't a raid. *(quality note)*
- **Mitigating candle need not close inside** — a live raid whose reclaim holds is valid; live and
  closed raids score equally. *(implemented)*
- **Manipulation need not be adjacent** — the raid is the first later candle to sweep the range
  extreme; candles in between stay inside (accumulation). *(implemented)*
- **ChoCH = first break, near the sweep** — the first close through the protecting swing, within a
  bounded window after manipulation (24 confirm candles); a later re-close is BOS, not ChoCH.
  *(implemented)*
- **Displacement since manipulation** — required for a tradable model, but a linked shift-FVG can
  substitute. *(implemented)*

## Validation, invalidation & sizing
- **blockers.length === 0 is the single READY gate** — soft issues are quality warnings, never
  vetoes. *(implemented)*
- **EQ consumed → setup spent** — no fresh entry once price mid-fills the range after the raid.
  *(implemented)*
- **Grade → auto risk size** — A+ 1.0 · A 0.85 · B 0.55 · C 0.30 · D 0.15. *(implemented)*

## Behaviour
- **Killzone = confluence, not veto.** *(implemented)*
- **No daily trade-count cap; only −2R daily brake.** *(implemented)*
- **News does not block by default.** *(implemented)*
- **Confirm-TF honesty** — all user-facing text speaks the signal's real confirm TF. *(implemented)*

## Reference-candle meaningfulness *(implemented 2026-07-15)*
- Range candles must be meaningful, not arbitrary. **Hybrid, not a hard filter**: every closed
  candle is a *candidate*, but `reference_candle_score` (`referenceCandle.ts`, Master §5) grades it.
  Components: imbalance body/range 0-30 (rejection < 0.3, strong ≥ 0.7), range vs ATR 0-25 (ideal
  0.8×–2.5×, exhausted > 3.5×), expansion vs recent median 0-15, meaningful HTF location 0-20,
  key-open/killzone session 0-10. An A imbalance candle adds ~9 to the setup score, a D/arbitrary
  candle ~2; a weak (D/C) reference candle raises a quality warning. Thresholds configurable via
  `REFERENCE_CANDLE_DEFAULTS`. Surfaced in evidence as `reference-candle`.
