# CRT Changelog

Newest first. Each entry: date · area · what changed · why.

## 2026-07-15 — CRT governance established
- Added `docs/CRT_MASTER_INSTRUCTION.md` as the permanent source of truth for CRT detection,
  directional bias, and Gemini interpretation (per user's permanent instruction).
- Seeded `knowledge/user_rules/crt_rules.json` and `docs/CRT_RULES.md` with the objective CRT
  rules approved across the session (anchor mapping, loose HTF alignment, live-raid parity,
  non-adjacent manipulation, first-break ChoCH near the sweep, EQ-consumed invalidation,
  single blocker gate, grade sizing, killzone/news/daily-cap behaviour, confirm-TF honesty).
- Recorded the **reference-candle meaningfulness** question as *proposed, pending user decision*.
- No strategy code changed — this is the "audit first, do not rewrite" step (Master §14).

### Audit findings (no code changed yet)
- **Gemini layer**: currently returns freeform mentor commentary (correct endpoint/model after
  the earlier fix), backend-only, key not exposed ✓. It does NOT yet use a system instruction +
  JSON response schema + event-ID validation (Master §10). Gap.
- **Evidence**: `evidence[]` carries category ids + candleIndex/time/price, but ids are per-
  category, not unique per-event. Master §9 needs unique event ids Gemini can reference. Gap.
- **Directional bias**: single 0–100 quality score; no separate bullish/bearish scores and no
  explicit external-draw-first engine (Master §8). Raw inputs (htfAlignment, liquidityObjectives,
  regime, PD) exist but aren't assembled two-sided. Gap.
- **State machine**: `setupPhase` has 4 states (context/raid/model/ready); Master §6 lists 10.
- **reference_candle_score**: not present; `rangeFromCandle` takes any closed candle (Master §5).
- **Repaint/lookahead**: LOW risk — `.closed` respected, pivots knowable only after the right
  wing, tracking starts at the retest, replay separates live-ready vs watch-promoted. Strength.
