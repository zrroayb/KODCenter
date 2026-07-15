# CRT Changelog

Newest first. Each entry: date · area · what changed · why.

## 2026-07-15 — CRT analysis UI panel + lifecycle/bias finish
- `fetchCrtAnalysis(signal)` client (crtInterpretation.ts) builds the deterministic payload and
  calls /api/gemini/crt-analysis, normalizing the structured response.
- SignalDetailsPanel now shows a "CRT Analiz (Gemini)" card: bias pill + confidence, plain-language
  summary, crt-state / reference-candle-quality / draw tags, and contradictions + missing-evidence
  lists. Loading / disabled / error states handled; styled in styles.css. Additive — the freeform
  mentor card stays.
- crt-analysis server timeout raised to 30s (structured output with a schema is heavier).
- Verified in the app: the panel renders, shows the loading state, and renders result/error
  correctly (the endpoint's structured "ready" success path was verified end-to-end earlier this
  session — bias, crt status, contradiction, known-only ids). 149 tests, build clean.

## 2026-07-15 — Gemini structured CRT interpretation layer (Master §10/§13/§14/§15)
- New `src/lib/gemini/crtInterpretation.ts`: `buildCrtGeminiPayload(signal)` emits the deterministic
  evidence as events with **unique ids** (`${signal.id}:${evidence.id}`) plus the crt block;
  `CRT_GEMINI_SYSTEM_INSTRUCTION` (interpret-only, no invented facts); `validateCrtInterpretation`
  rejects invalid JSON, missing required fields, and any response referencing an unknown event id.
- New backend endpoint `/api/gemini/crt-analysis` (vite.config.ts, additive — the freeform mentor
  commentary is untouched): calls Gemini with `systemInstruction` + `responseMimeType: application/
  json` + `responseSchema` (Master §15), strips code fences, parses, and validates unknown ids.
- Tests: `crtInterpretation.test.ts` (unique ids, accepts known-id response, rejects invented id,
  rejects malformed). 149 tests pass.
- Verified end-to-end against real Gemini: returned valid structured JSON, bias neutral, crt status
  "developing", ref quality "medium", correctly flagged the 1d/1w-vs-4h contradiction, and
  referenced only known event ids (2/2). Needed maxOutputTokens 4096 + a "keep reasoning concise"
  instruction so the JSON isn't truncated mid-field.

## 2026-07-15 — two-sided directional bias implemented (Master §8/§11)
- New `src/lib/strategies/crt/directionalBias.ts`: separate bullish/bearish scores in draw-first
  order (external draw 0-25, HTF structure 0-25, PD 0-15, reclaimed sweep 0-15, displacement 0-10,
  LTF MSS 0-5, killzone timing 0-5). Decision: bullish if ≥65 and margin ≥15 (bearish symmetric),
  else neutral; PD alone never forces direction. Configurable weights/thresholds.
- Wired into `crt.strategy.ts` as the `directional-bias` evidence item (structured bias for
  Gemini/UI). It grades the market's lean + confidence and flags contradictions when a per-anchor
  signal disagrees with the dominant lean — it does NOT override the per-anchor direction (Master
  §14: don't rebuild working modules).
- Tests: `directionalBias.test.ts` (bullish/bearish stacks, neutral on conflict, PD-alone stays
  neutral). 145 tests pass.
- Live read: XAUUSD short → bearish bias (pass), EURUSD long → bearish bias (warning, real
  contradiction surfaced), ETHUSD short → bearish bias (pass).

## 2026-07-15 — reference_candle_score implemented (Master §5)
- New `src/lib/strategies/crt/referenceCandle.ts`: grades every candidate CRT range candle 0-100
  (imbalance body/range, range vs ATR, expansion, meaningful location, key-open/killzone),
  returns grade + per-component reasons. Grounded in ict-knowledge-library CRT checklist,
  XAU-60 body/ATR/expansion filters, crt-turtlesoup-ea wick/body.
- Wired into `crt.strategy.ts`: reference candle found by exact high/low match on the range TF,
  scored, fed into the setup score (~9 for an A imbalance candle, ~2 for a D), surfaced as the
  `reference-candle` evidence item, and a quality warning fires on a weak (D/C) or exhausted
  candle. Hybrid, not a hard filter — a weak range candle loses score, never vetoes (keeps the
  "blockers = single gate" rule).
- Tests: `referenceCandle.test.ts` (imbalance vs doji ranking, exhaustion, A/D grading,
  component explanations). 141 tests pass.
- Live read (8 symbols, 30d): reference-candle grade spread D5/C14/B18/A21 (real differentiation);
  setup-grade spread and replay live-READY unchanged (+1.86R) — quality signal added, no edge
  regression.

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
