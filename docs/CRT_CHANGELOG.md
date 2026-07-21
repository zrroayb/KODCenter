# CRT Changelog

Newest first. Each entry: date · area · what changed · why.

## 2026-07-22 — R-growth pass: 1H→5M anchor (tracking), unfilled-entry cost, EQ-RR gate scenario
- Goal was to grow R without touching the quality gates that produce WR ~77%. Three additions,
  all evidence-first:
  1. **1H→5M anchor (Master §8's fifth mapping, previously missing).** New AnchorSpec 1h/5m;
     every rangeTf conditional widened (rangeCandlesFor, confirmCandlesFor/live, crtBias TF,
     ACTIVE_CRT_LOOKBACK, HTF_ALIGNMENT_CHAIN gains 1h→[4h,1d], RANGE_TF_RANK). Guarded by
     `intradayAnchorMode` (default "tracking"): the 1H family CAN NEVER be READY live — it shows
     as watch, never pages Telegram — until it earns its own 30+ trade evidence. Only
     `intradayAnchorMode:"live"` promotes it. This is the §14 audit-first rule applied to a new
     setup family. **Demo-window tracking result: 7/9 triggers, 0.55R/trade, PF 2.94, 3.87R,
     WR 71.4% — higher expectancy than the 4H headline, nearly doubling N.** Strong candidate to
     promote to live after 30 tracked trades.
  2. **Unfilled-entry counterfactual.** CRT retest orders that never fill / expire now record
     `unfilledCounterfactualR`: what a market entry at the next candle open (same stop/targets,
     eq-full walk) would have paid. Aggregated in reviewMeasurements.unfilled. Measures the
     ~48% no-fill leak's real cost — the adverse-selection question (are the strongest,
     no-retest setups being systematically missed?). Zero in the demo window (all filled);
     infrastructure ready for live data.
  3. **EQ-RR ≥ 1 filter scenario.** filterScenarios gains eq-rr-floor — the gate filters on DOL
     distance while the exit realizes at EQ. **Demo: 0.42R/trade, PF 2.26 vs headline 0.33R/PF
     2.15 — filtering to EQ-RR ≥ 1 lifted expectancy, confirming the gate/exit tension.**
- Replay is partitioned: 1H tracking trades run through a shared buildMeasuredReplayTrade path
  with their own setup/day-risk state (never consume the core daily quota) and are excluded from
  headline totals/bySymbol/reviewMeasurements; reported only as trackingScenarios + trackingTrades.
  Nothing here changes a live rule or a headline number. 208 tests pass; UI verified in Replay
  deep-dive; console clean.
- Owner decisions still pending at the 30-trade review (measure now, decide then): promote the
  1H anchor to live, switch the RR gate to EQ-RR, and act on the unfilled-entry leak.

## 2026-07-21 — review instrumentation: measure now, decide at 30+ trades (trade-logic analysis)
- The trade-logic analysis surfaced two structural tensions that are NOT rule changes yet:
  (1) the RR gate filters on DOL distance while the exit model realizes at EQ (0/13 DOL hits
  live), and (2) correlated same-day exposure (dollar-fx/crypto clusters) is invisible to the
  single -2R daily brake. Per the 30+ trade rule, nothing changes now — but the review needs
  data that must start accumulating today.
- Replay now records per trade `eqRR` (entry→EQ distance / risk) and the summary gains
  `reviewMeasurements`: EQ-RR distribution (mean, <1R, <1.5R), cluster days (same day + same
  cluster + same USD/crypto-normalized side, ≥2 trades), grade buckets (does the sizing curve
  match realized R), killzone buckets (confluence-not-veto contribution). Surfaced in the
  Replay deep-dive as "30+ işlem incelemesi ölçümleri". None of it feeds any filter.
- First demo-window reading: mean realized EQ-RR 0.93R with 5/8 trades under 1R — the
  gate/exit tension is real and now visibly tracked. Cluster classifier: EURUSD short ≈
  USDJPY long ≈ usd-long; crypto normalized to crypto-long/short. Tests added (consistency
  against triggered counts + cluster grouping); 207 tests pass.

## 2026-07-19 — user rules sync to D1; the cloud bot scans with the site's rules
- Closes the "bot runs on defaultRules" gap from the alert-parity fix: the Ayar screen now
  mirrors every rule change to the worker (`POST /api/rules`, debounced 1s, fire-and-forget;
  vite dev has no endpoint and the sync silently no-ops). The 5-minute cloud scan fetches the
  mirror (`GET /api/rules`, SCAN_TOKEN) and falls back to defaultRules if unreachable —
  rules sync can never block a scan. Scan log gains `rulesSource: cloud|default`.
- One shared sanitizer `resolveStoredRules` (defaults merge + symbol/killzone whitelist +
  minimum-score floor) now backs BOTH localStorage loading and the cloud path — divergent
  sanitize was itself a parity risk. D1 table `user_rules` (migration 0002 + ensureSchema).
- POST is deliberately tokenless (same-origin page cannot hold the scan token; worst case is
  a prefs overwrite that the sanitizer clamps). GET stays token-gated.
- Direction is one-way browser → D1: the browser owns the rules, D1 is the bot's mirror.

## 2026-07-19 — Telegram alerts now respect site visibility (owner: gold alert, site empty)
- Owner got a XAUUSD READY alert on Telegram while the site listed nothing. Cause: the cloud
  scan alerted from `[...signals, ...hiddenSignals]` — hiddenSignals is precisely what the
  rules/decision-class/18-signal cap deliberately reject, so the bot paged on signals the UI
  hides by design.
- Fix: shared `alertableReadySignals(result)` gate in scanRuntime (READY ∩ the same visible
  set the site lists, deduped); cloud-scan uses it. Parity test added; 192 tests pass.
- Note: the cloud bot runs on `defaultRules` (score floor 50, cap 18 — same as the UI floor).
  If browser-local rule edits diverge from defaults, small mismatches remain possible until
  rules sync to D1; the systematic hidden-signal leak is gone. Takes effect on the next
  5-minute background scan after merge.

## 2026-07-19 — stop anchors to the raid leg's running extreme (owner: "stop doğru durmuyor")
- Owner screenshot (AUDUSD 1D short): stop 0.70050 sat INSIDE later raid wicks (~0.7013) with a
  bloated 1:7.12 RR. Root cause: `raidFromPair` froze `raid.level` at the FIRST raid candle's
  wick, while `raidStillActive` deliberately tolerates later wick pokes (distribution/noise) as
  long as closes hold the reclaim — so the same raid leg could print higher wicks the stop
  never followed.
- Fix in `detectAnchorRaid`: while the raid is active, the manipulation extreme is the leg's
  running extreme (later closed candles + the forming wick, live-raid parity). Same rule applied
  to the confirmation-TF sweep variants in `manipulationForAnchor` (range + swing sweeps).
- Effect: stops can only WIDEN to sit beyond printed liquidity; RR drops accordingly (honest
  direction). `raid.level` had no other consumers. Regression test added (running extreme incl.
  forming wick). 191 tests pass; verified in the app — AUDUSD stop now sits above the highest
  printed wick with RR 1:1.22 instead of inside the wick at 1:7.12.

## 2026-07-17 — session confluence: past sessions can no longer masquerade as live (owner complaint)
- Owner: the Session view listed setups from long-finished sessions (and previous days) as
  "Canlı" — ASIA 84 / LONDON 227 counters, "81 gelişiyor". Root causes, both fixed:
  1. **Engine**: the confirmation window was a flat 12h tail past the trigger session, and the
     WAITING_* chain never re-checked it (a swept-but-unreclaimed setup stayed WAITING forever).
     The profile declares `confirmationSession = trigger`, so the deadline is now trigger end +
     one 15m confirmation candle (`CONFIRMATION_GRACE_MS`); past it the lifecycle is LATE (full
     sequence) or EXPIRED — never WAITING. The 12h constant remains only as
     `EXPIRED_RETENTION_MS` so expired pairs keep being emitted for logging/history.
  2. **Store**: setups from a previous trading day were never re-detected, so their stored
     WAITING_* state froze in "Canlı" indefinitely (up to the 400-entry cap). Reconcile now
     expires non-terminal setups from an older trading day as soon as the same profile shows a
     newer day (idempotent `id:EXPIRED` log). Same guard added to the Silver Bullet store for
     pre-entry states past the 11:00 window (+5 min) — filled/active trades are untouched, the
     strict deadline applies to entry, not exit (SB master rule preserved).
- UI: the session day-timeline now counts only the newest trading day per profile instead of
  the whole 400-entry history store.
- Note: the engine clamps "now" to the last candle time (data honesty), so expiry needs a candle
  after the window close — tests cover this. 190 tests pass.
- Primary replay/management model is now **Hepsi-EQ**: the whole position exits at EQ/TP1, no
  DOL runner, no BE move. Same-entry counterfactuals measured it at ~2x the old model
  (11.85R vs 6.12R on the report window; re-verified 11.06R vs 4.67R, WR 82%).
- DOL is untouched as the setup's structural draw — validity, direction and RR gating still
  use it; only the exit changed.
- Reversible: the old EQ-partial+BE model lives behind `settings.exitModel = "eq-partial-be"`
  and is continuously tracked as the `eq-partial-be` management variant (scenario list now
  shows the new model as reference). Revisit at the 30+ trade review.
- New outcome reason `eq-full` ("EQ tam çıkış") in UI + replay-review labels; eqTooClose and
  EQ/TP1 texts updated to the new exit language. Tests updated; legacy behavior still locked
  behind the setting.

## 2026-07-16 — AI report audit #3: Asia demotion REJECTED with receipts
- Report proposed "Session Asia READY -> WATCH" off a 0.15R/4-trade bucket. Independent
  measurement: the Asia bucket is polluted by watch-promoted counterfactuals (the 6/19 AUDUSD
  WATCH->ENTRY loser). **Live-only Asia = 3 triggers +1.62R** — including GBPUSD +2.62R tp2, the
  window's biggest winner, which the proposed rule would have blocked. Rejected; also consistent
  with the user rule "killzone = confluence, not veto".
- Calibration suggestions (governance-caution / watch-promoted / HTF-conflict tighten) all rest
  on 2-sample buckets — rejected per the 30+ trade rule.
- Confirmed: live-READY 20 signals / 11 triggers / WR 73% / +7.12R — the retest-mandatory +
  reversal-exception + NaN fixes measure strongly (report's PF 4-8 range verified).
- **Watch candidates logged (no action until 30+ trades):**
  - Management: same-entry counterfactuals say full-close-at-EQ 11.85R > BE-yok 8.30R > current
    EQ-partial+BE 6.12R. Doctrine says EQ partial + DOL runner; the data currently disagrees.
    Owner's call at the 30+ review — the replay tracks all variants continuously.
  - SMT bonus: SMT-aligned 0/2 while "SMT yok" runs +0.56R; the +8 score bonus may be noise.

## 2026-07-16 — reversal-at-external-liquidity exception (owner's USDCHF short)
- Owner took a textbook USDCHF 4H short (buy-side raid of the old highs at 0.8152 → reversal
  toward 0.8010) that the bot SAW (RETURNED_INSIDE on the exact range) but auto-vetoed on every
  anchor with "HTF yönü karşı: 1d bullish + 1w bullish". Structural flaw: at a top the HTF candle
  bias is still bullish BY DEFINITION — the old hard veto made every top/bottom reversal
  untakeable.
- Per Master §10.2/§10.4 (a swept draw is consumed; a buy-side sweep is bearish evidence): when
  the manipulation swept weekly/monthly-tier external liquidity (PWH/PML) or a STRONG opposing
  liquidity pool (old structural high/low, equal highs/lows), the opposing-HTF read demotes from
  veto to a size-down warning. Every other gate still applies. Evidence/checklist show the
  exception explicitly.
- Verified live: USDCHF 1W SHORT score 83 now carries the exception (veto gone); non-external
  readings stay vetoed. 12-symbol replay: live-READY +3.12R, 0 NaN. New regression test.
- Also fixed alongside (separate commit): NaN synthetic bid/ask from a forming Yahoo candle
  poisoned replay R computations (`NaN ?? fallback` keeps NaN) — executable prices now guard
  with Number.isFinite.

## 2026-07-15 — retest mandatory again: ChoCH close alone never confirms
- An AI replay report proposed demoting choch-close entries from READY (-0.46R / 5 trades).
  Independent measurement confirmed the numbers AND found the real cause: the "choch-close"
  bucket is dominated by the refactor-era *direct entry from the closed ChoCH candle* (no
  retest) — the retest-based model (poi-retest) was making +0.56R at the same time.
- `selectCrtEntry` now deliberately ignores `confirmationClose`: without a real retest the entry
  stays PENDING at the retest level (WATCH), exactly as the original owner rule said
  ("displacement kovalanmaz, retest bekle"). Warning text updated; test locks the behavior.
- Measured after (12 symbols, 30d): live-READY -0.14R -> +2.62R; poi-retest +0.89R edge;
  choch-close bucket normalized to +0.09R neutral. Fewer triggers (5 -> 1) — selectivity by
  design, counterfactuals still tracked.
- NOT applied from the report: chop veto (2 trades, both losers — sample too small to overturn
  the user's chop-is-a-note rule) and stop-in-noise re-promotion (1 trade). Logged for the 30+
  trade review. HTF-aligned re-measured: +0.20R, already a READY gate.

## 2026-07-15 — Knowledge retrieval (§16) + structured payload (§9/§12)
- New `src/lib/gemini/crtKnowledge.ts`: a compact in-repo CRT knowledge base (original concise
  concept definitions) + `retrieveCrtKnowledge` that returns only 3-8 records relevant to the
  signal (direction-specific + core sequence, plus turtle-soup when present) — never the whole
  base (Master §16). System instruction notes these are reference definitions, not market facts.
- `buildCrtGeminiPayload` enriched: a structured `directional_bias` block (bullish/bearish scores,
  confidence, external draw) + `reference_candle_score`/grade on the crt block + the retrieved
  `knowledge` array — matching the Master §9/§12 evidence contract. Backed by new compact fields
  on `CrtAnchorInfo` populated from the setup's directionalBias/referenceCandle.
- Tests: `crtKnowledge.test.ts` (3-8 cap, direction-specific selection, turtle-soup gating,
  uniqueness) + payload-enrichment assertion. Full suite 155 tests pass.
- Live: XAUUSD payload carries directional_bias {bearish 46/71, draw PDL}, reference_candle 100/A,
  7 knowledge records, 12 unique events.

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
