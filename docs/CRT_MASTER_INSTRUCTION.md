# PERMANENT CLAUDE INSTRUCTION — CRT Detection, Directional Bias & Gemini Interpretation

> This file is the permanent source of truth for the CRT part of this trading project.
> Before performing any task related to Candle Range Theory, directional bias, market
> direction, higher-timeframe analysis, liquidity sweeps, CRT candle selection, CRT setup
> validation, Gemini interpretation, trade grading, or entry/stop/target selection — **read this
> file first.** Do not answer or modify code based only on the latest user message. Always
> evaluate new instructions against this document and previously approved user rules
> (`knowledge/user_rules/crt_rules.json`).

## 1. Project objective
The bot already detects many market events; the main weakness is **interpretation**. The goal is
not to rebuild the bot but to improve: (1) correct CRT reference-candle selection, (2)
directional-bias determination, (3) CRT setup validation, (4) multi-timeframe interpretation,
(5) Gemini's ability to explain the bot's deterministic output, (6) rejection of weak or
context-free CRT setups.

Architecture must remain:

```
OHLC DATA → EXISTING DETERMINISTIC BOT → CRT + DIRECTIONAL-BIAS EVIDENCE
→ RELEVANT KNOWLEDGE RETRIEVAL → GEMINI INTERPRETATION → VALIDATED JSON RESULT
```

The deterministic bot detects market **facts**. Gemini **interprets** those facts. Gemini must
not invent market facts.

## 2. Reference repositories (inspect, do not ship)
Cloned under `references/` (gitignored). Inspect licence, repainting, lookahead, future-candle
access; compare with the existing project; extract only required logic; add tests; keep
architecture intact.

- `SrsBlack/ict-knowledge-library` — concept definitions, terminology, bias interpretation,
  required evidence, invalid conditions, Gemini knowledge retrieval.
- `joshyattridge/smart-money-concepts` — deterministic building blocks (swings, BOS, CHOCH, FVG,
  liquidity, sweeps, previous highs/lows, sessions, retracements). Compare, do not auto-replace.
- `n30dyn4m1c/crt-turtlesoup-ea` — three-candle CRT (range / manipulation / confirmation), sweep,
  midpoint & opposite-range targets, wick/body filters. **One implementation, not the universal
  definition.** Colour / wick-body ratio / range-size / exactly-three-candles must stay
  configurable and backtested.
- `semirkabir/HTF-Po3` — HTF candles on LTF, previous HTF high/low, HTF sweeps, close-back-inside,
  LTF confirmation, session filtering, DST, sweep invalidation.
- `lordgaruda/XAU-60` — `strategies/crt_tbs.py`, `config/strategies/`, `core/backtest_engine.py`:
  Python CRT organisation, sweep-quality scoring, session-range handling, backtest architecture.
  **Reject** RSI/MACD/EMA/ADX/generic-indicator direction.
- `maghdam/chatgpt-trading-strategy-assistant` — architecture reference for structured analysis
  endpoints, HTF-bias output, AI-readable evidence, checklists, JSON contracts, prompt org.
- `googleapis/python-genai` — official Gemini SDK patterns: structured output, JSON-schema
  validation, system instructions, caching, error/retry. Never expose the key in frontend;
  Gemini runs through the backend.

## 3. Concepts Claude must understand (CRT + direction only)
- **Market structure**: swing high/low, HH/HL/LH/LL, internal/external, protected high/low, BOS,
  CHOCH, MSS. Do not label every pivot break as meaningful — weigh level importance, protection,
  candle close, displacement, prior liquidity, HTF context.
- **Liquidity**: buy/sell-side, equal highs/lows, PDH/PDL, PWH/PWL, previous HTF candle high/low,
  session high/low, external/internal, sweep/raid, failed breakout. A wick through a level is not
  automatically a sweep — a valid sweep needs a meaningful level, trade beyond it, failure to
  accept, close back inside / strong rejection, reaction/displacement away, and a logical
  opposite-side target.
- **Dealing range**: range high/low, equilibrium, premium/discount, internal/external range
  liquidity. Range must have a structural reason. Discount favours longs, premium favours shorts —
  but PD alone must not determine direction.
- **Displacement**: body vs recent median body, range vs ATR, close near extreme, consecutive
  directional candles, structure broken, FVG created, follow-through. Larger-than-previous is not
  displacement.
- **FVG**: confirmation after sweep+displacement, never sole direction. Weigh direction, size,
  displacement, structural consequence, location, freshness, mitigation, HTF alignment.

## 4. CRT definition for this project
CRT = treating the high and low of a **completed reference candle** as a meaningful range, then
watching how price interacts with it (same TF or lower):

```
REFERENCE RANGE → ONE SIDE SWEPT → PRICE FAILS TO ACCEPT OUTSIDE → PRICE RETURNS INSIDE
→ DISPLACEMENT / STRUCTURAL CONFIRMATION → DELIVERY TOWARD MIDPOINT OR OPPOSITE SIDE
```

CRT is **not** "any large candle + any wick outside it = trade". A CRT reference candle must be
important.

## 5. CRT reference-candle selection
A candle earns a high-quality classification only with a meaningful reason. Evaluate: completed?
timeframe? at meaningful HTF liquidity? near a valid PD array / structural zone? created or
reacted from displacement? does its high/low represent relevant liquidity? part of a meaningful
session? range large enough vs recent volatility? excessively large & exhausted? logical
opposite-side target? HTF narrative supports it? range already delivered / invalidated?

**Do not** select a reference candle only because it is visually large, has a long wick, is the
latest candle, is bullish/bearish, or price touched its high/low. Return a
`reference_candle_score` and explain every component.

## 6. CRT pattern states (lifecycle, not a boolean)
`CANDIDATE, ACTIVE_RANGE, SIDE_SWEPT, RETURNED_INSIDE, CONFIRMATION_PENDING, CONFIRMED,
TARGETING_MIDPOINT, TARGETING_OPPOSITE_EXTREME, INVALIDATED, COMPLETED`. Do not return only
`bullish_crt = true`.

## 7. Bullish / bearish CRT requirements
**Bullish**: valid reference range → sweep of reference low → failure to accept below → close back
inside / clear bullish rejection → bullish displacement → optional LTF MSS/CISD/CHOCH/FVG →
reachable target above → no major bearish contradiction. Targets: EQ, internal liquidity, CRT
high, external buy-side. Invalidation: acceptance below swept low, decisive close below range,
no displacement, opposite structural confirmation, target already reached, HTF bearish draw
dominant. **Bearish** = inverse. Never label a bare low/high sweep as CRT without confirmation.

## 8. Directional-bias engine
CRT must not independently create bias. Direction is established **before** the final CRT
evaluation, in this order:

```
EXTERNAL LIQUIDITY DRAW → HTF STRUCTURE → DEALING-RANGE LOCATION → RECENT LIQUIDITY EVENT
→ DISPLACEMENT → LTF CONFIRMATION
```

Default TF roles (configurable, not hard-coded per symbol): 1D macro, 4H active structure/range,
1H CRT development, 15M confirmation/execution. Alternative mappings: Monthly→Daily CRT,
Weekly→4H CRT, Daily→1H CRT, 4H→15M CRT, 1H→5M CRT.

Separate **bullish_score** and **bearish_score** (starting weights, configurable & backtested):
external liquidity draw 0–25, HTF structure 0–25, premium/discount 0–15, meaningful sweep 0–15,
displacement 0–10, LTF confirmation 0–5, session/timing 0–5. Decision: bullish if `bullish ≥ 65
and bullish − bearish ≥ 15`; bearish symmetric; otherwise **neutral**. Return neutral/uncertain
when 1D/4H strongly conflict, draw unclear, price near EQ, both sides swept, no displacement,
ranging, targets reached, scores close, or data missing. Never force direction.

## 9. Deterministic bot output (evidence contract)
Structured JSON with `directional_bias` (direction, bullish_score, bearish_score, confidence,
external_draw, supporting/contradicting event ids), `higher_timeframes` (per-TF structure,
dealing_range, location, liquidity_levels, events), and `crt` (reference_candle_id/tf/high/low,
equilibrium, reference_candle_score, state, swept_side, sweep_event_id, returned_inside,
displacement_event_id, confirmation_event_ids, direction, targets, invalidation). **Every event
has a unique event ID. Gemini may only reference provided event IDs.**

## 10. Gemini responsibility
Gemini may: explain bias, explain why the CRT candle is relevant, explain the sweep, connect
HTF/LTF, identify contradictions, describe missing confirmation, rank targets, explain
invalidation, reject the setup, produce a readable summary. Gemini must **not**: detect a new CRT
candle / BOS / sweep / FVG / price level / target, change timestamps, override deterministic
direction without explaining contradictions, or claim validity because it "looks correct". When
evidence is insufficient, return `INSUFFICIENT_DETERMINISTIC_EVIDENCE`. Gemini runs under a strict
system instruction, returns **validated JSON** matching the response schema, backend-only, key
never in frontend.

## 11. Knowledge retrieval
Do not send all repository content to Gemini. Retrieve only relevant knowledge (usually 3–8
concept records). Bullish candidate → CRT reference range, sell-side sweep, return inside, bullish
displacement, bullish MSS, discount, opposite-side delivery. Bearish → inverse.

## 12. Permanent user learning (this repo)
Maintain `docs/CRT_RULES.md`, `knowledge/user_rules/crt_rules.json`, `docs/CRT_CHANGELOG.md`.
When the user teaches/corrects a CRT rule: read this file, compare, determine which area it
affects (reference-candle selection / bias / sweep / confirmation / targets / invalidation /
scoring / Gemini), convert to an objective rule, save to `crt_rules.json`, update `CRT_RULES.md`,
add a changelog entry, add/update tests, use it in future work. **User-approved rules have
priority over repository assumptions and must never be silently forgotten.** Do not treat a casual
chart example as a universal rule unless the user clearly states it is general.

## 13. Repository filtering
Classify each relevant file: `USE DIRECTLY / REFACTOR / REFERENCE ONLY / REJECT`. Reject logic
that repaints, uses future candles / hindsight pivots, forces direction, uses RSI/MACD/EMA as
primary CRT direction, calls every wick a sweep, selects every large candle as CRT, uses arbitrary
un-configurable thresholds, has no invalidation, or has no testable conditions.

## 14. Initial task (audit first — do not rewrite)
Audit existing CRT impl, directional-bias logic, Gemini integration; inspect the repos; find which
detectors already provide the required evidence; identify missing fields, contradictions,
repaint/lookahead risks; propose a normalized CRT evidence schema, a directional-bias scoring
model, and the Gemini input/response schemas; list exact files to modify and tests to create.
After the audit, implement the **smallest necessary changes**. Do not rebuild working modules.

## 15. Final rule
The system must not search for CRT patterns everywhere — only **meaningful CRT setups at
meaningful locations**. Decision order:

```
DIRECTION → IMPORTANT LOCATION → VALID CRT RANGE → LIQUIDITY SWEEP → RETURN INSIDE
→ DISPLACEMENT → CONFIRMATION → TARGET → INVALIDATION
```

A setup with missing direction, location, or confirmation is rejected or classified as
*developing*. The deterministic bot supplies facts; Gemini interprets; **the user's CRT rules
define final project behaviour.**
