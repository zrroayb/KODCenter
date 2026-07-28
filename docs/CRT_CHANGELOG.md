# CRT Changelog

Newest first. Each entry: date · area · what changed · why.

## 2026-07-28 — clarify the misleading "1h ChoCH yok" blocker
- Owner (rightly): BTC clearly had a 1h ChoCH — after sweeping 62,742, price closed 63,928 above
  the 63,669 swing high — yet the 1d long said "1h ChoCH/shift mum kapanışı yok". Both true, but
  the message was misleading: the 1d anchor's confirmation must break the swing high that existed
  BEFORE the 1d-range-low sweep (65,078 here), not any LTF pivot. The small LTF sweep→ChoCH the
  owner read IS valid — it's the 1H-anchor setup, which stays tracking-only precisely because live
  data measured it at −2.77R / PF 0.31 / 20% win (see the 1H-anchor demotion, 2026-07-22).
- Fix: the blocker now names the exact level the setup needs — e.g. "1h kapanışı bu 1D setup'ın
  gerektirdiği swing high 65,078'i kırmadı (küçük LTF ChoCH bu setup'ı onaylamaz)" — so a visible
  LTF ChoCH no longer contradicts the message. Blocker/message only; detection and the measured
  edge are unchanged. Full suite 239.

## 2026-07-28 — fix chop over-collapse + never hide an HTF (1d/1w) setup
- Owner caught it live: BTC had a valid 1d LONG (price swept the 1d range low ~63,739 and reclaimed
  — a with-trend discount long), but the app showed only "BTCUSD · chop · dur" and never surfaced
  the long. Two causes, both mine from the previous day's changes:
  1. Chop over-collapse: `chopConflict` fired on ANY opposing live raids, so a 1d long raid + a 1h
     short raid was labeled chop and collapsed to a contentless "dur" row — erasing the 1d long. A
     1d/1w-vs-LTF split is NOT chop; it is "HTF trend + LTF pullback", and the HTF read is the point.
     Fixed: chop is now determined ONLY from 1d/1w raid directions conflicting with each other.
  2. Global cap hid the HTF setup: the 1d long is an early C/58 watch (unconfirmed, waiting on a 1h
     ChoCH), so it ranked below the 18-signal global cap and fell into the collapsed "early/rejected"
     details — invisible. Fixed: HTF (1d/1w) watch/ready signals are promoted past the cap so the
     big-picture context is never hidden by a pile of LTF watches from other symbols.
- Verified on live data via the real `scanContexts` runtime: BTC 1d LONG (C/58) now lands in the
  VISIBLE list alongside the 1h short, and BTC no longer renders as "chop". HTF promotion is bounded
  (≤2 anchors/symbol) so it does not flood the board. Full suite 239; typecheck clean; continuation
  edge untouched (visibility/labeling only).

## 2026-07-27 — audit fixes: counter-trend labeling + consumed-setup grade
- A system audit across all 12 symbols surfaced two "saçma" (nonsensical-looking) patterns:
  (1) the direction engine and CRT frequently point opposite ways — on many symbols the only CRT
  watch was counter to the HTF trend, and continuation (the with-trend playbook) is sparse, so the
  board looked like it perpetually wants to fade the trend; (2) dead setups (missed/invalidated)
  still displayed grade A/A+, reading like a live high-quality trade.
- Fix #1 — counter-trend flag: `TradingSignal.counterTrend` is set on a CRT signal when its
  direction opposes the daily structural trend AND it is NOT a reversal-at-external-liquidity
  (`reversalAtExternalHtf`) — so CRT's measured liquidity-fade edge is preserved; only the
  UNJUSTIFIED counter-trend fades are marked. `compareSignalsByDecision` now ranks counter-trend
  watches BELOW trend-aligned ones within a stage, so the headline/decision prefers a with-trend
  signal (e.g. a continuation LONG) over a counter-trend CRT fade. The scanner card and decision
  strip show a "trende karşı" tag. Verified live: ETH (daily bullish, CRT short) and EUR (daily
  bearish, CRT long) get the tag; USDCHF/GBP reversal-at-liquidity do NOT; neutral-daily XAU does
  not. Generation is unchanged (flag affects ordering/display only), so the measured edge stands.
- Fix #3 — consumed-setup grade: the signal detail panel no longer shows a live "A · 88 kalite"
  for a missed/invalidated setup; it shows "Tüketildi/Geçersiz · A/88 idi" in muted styling, so a
  dead setup can't be mistaken for a live opportunity.
- Full suite 238 pass; typecheck clean.
- Follow-up (same day, both deferred items done): (a) CHOP COLLAPSE — when a symbol has opposing
  live raids (long+short), its active signals are marked `chopConflict`, ranked to the bottom of
  their stage in `compareSignalsByDecision`, and collapsed in the scanner to a single "chop · dur"
  row ("zıt yönlü raid; yön yok, LTF onayı bekle") instead of two competing tradeable cards.
  (b) ACCEPTANCE-SUPPRESSION WIDENED — the counter-trend accepted-fade suppression now fires on a
  MODERATE (not only strong) directional daily, so a moderate-uptrend symbol like BTC also drops
  its accepted counter-trend short; only weak/neutral daily is exempt. Both are display/ordering/
  CRT-emit changes — measured continuation edge is unchanged (prod 46 trades +1.13R PF 3.45, CRT 0,
  identical to pre-change). Full suite 239.

## 2026-07-27 — internal-structure (LTF) MSB reading in the direction engine
- Owner caught it live on BTC: h1 was a strong up-move to 65,744, then a decisive drop that closed
  below the protective higher-low (~65,100) and held — a clear internal MSB down that a trader
  reads as bearish. But the structural engine returned "expanding / neutral", because its wing-3
  swings only saw HH(65,744)+LL(64,418) = broadening and no wing-3-level close-break. The engine
  was blind to internal (minor) structure. Owner: "the msb is the correct read — apply it generally."
- Fix: `detectInternalMsb` (wing-1 minor swings) runs ONLY when the major wing-3 read is ambiguous
  (expanding / contracting / no-break). It collects break-and-hold events — for each minor swing
  high, did a close break below its protective low and is price STILL below it (and the symmetric
  up case) — and, in a two-sided chop, RECENCY breaks the tie (the most recent holding break is the
  current character). When found, the engine returns that direction with **weak** confidence and a
  ChoCH lastEvent, instead of a blind neutral. Clean trends (uptrend/downtrend) are untouched, and
  when no internal break holds it still returns honest neutral (verified on a contracting/mid-range
  series). BTC h1 now reads bearish MSB @65,100 — the owner's read.
- Deliberately conservative wiring: the internal read keeps `pattern` as expanding/contracting, so
  it does NOT by itself open the continuation trend gate (which requires a clean daily trend). Its
  only downstream effect is the bias LABEL (weak directional vs neutral), which feeds scoring and
  the h4-alignment gates.
- MEASURED (real data, 60d, 12 symbols) before→after: prod continuation 57→**46 trades**,
  +1.49R→**+1.13R** expectancy, PF 4.41→3.45; OOS split still **edge** (IS +1.36R/PF3.88,
  OOS +0.51R/PF1.76); cross-sectional 4/5 symbols positive. The edge holds — slightly more
  conservative because the h4-opposition gate now fires on some internal-MSB directional reads that
  were previously neutral-and-tolerated. A directional-accuracy improvement with a modest
  fewer-signals cost, not a degradation. CRT unchanged. Tests: structuralBias suite updated
  (broadening → internal-MSB bullish + choch event; contracting → honest neutral); full suite 238.

## 2026-07-26 — live-forward outcome logging + weekly edge report (per playbook)
- Validation so far is all backtest/replay. The real confirmation is live-forward: log every READY
  the bot fires and score what price actually did. Built on the existing alert_log (which already
  stores each fired READY with its plan) — no new pipeline.
- alert_log gains `outcome` / `r_multiple` / `resolved_at` columns (guarded PRAGMA-checked ALTER, so
  ensureSchema stays cheap). Alert records now also carry `strategyId` so outcomes split by playbook.
- Resolution: `resolveOpenAlerts` runs at the end of every scan (handleScanFinalize, best-effort) —
  for each unresolved READY within 14 days it walks that symbol's fresh m15 snapshot candles after
  the alert time and marks win (first target/EQ hit, +RR), loss (stop first, −1R, stop wins ties —
  same conservative convention as replay), or expired (close-based R after ~96 m15). Single target =
  CRT eq-full and continuation's one target, so one resolver serves both.
- Report: public read-only `GET /api/edge-report?days=7` groups resolved outcomes by playbook
  (trades / totalR / expectancy / win% / PF). `npm run report:edge` (EDGE_DAYS, CLOUD_SCAN_URL
  overrides) prints it as a table with an edge/avoid/nötr verdict per playbook.
- Dependency: resolution rides the cloud-scan cadence (GitHub Actions), so it only accrues while the
  background scan is alive — the same CI-health thread flagged on 2026-07-24. When the bot runs, the
  report fills in on its own; this is the mechanism that will let continuation graduate from
  "measured-oos-validated" to live-proven. Tests: full suite 237 pass; worker + app typecheck clean.

## 2026-07-26 — Trend Continuation multi-axis validation (edge holds out-of-sample)
- The single 60d pass wasn't enough to trust the edge. New `scripts/validate-continuation.ts`
  (`npm run validate:continuation`) runs ONE real-data replay, then splits the resulting trades on
  two independent axes and applies the replay verdict thresholds (min 12 trades; edge = expectancy
  ≥0.15 & PF ≥1.15). Data limit (Yahoo m15 ~30–60d) rules out many non-overlapping windows, so
  the two axes are: (a) temporal in-sample vs out-of-sample split at the median signalTime,
  (b) cross-sectional per-symbol (12 independent markets).
- Result (prod minRR 1.5 + costs, 60d, 12 symbols):
  - Overall: 42 trades, +1.07R expectancy, PF 2.87 → EDGE.
  - Temporal: in-sample 21 trades +1.50R PF 4.15 → edge; **out-of-sample 21 trades +0.64R PF 1.97
    → edge**. The edge survives out-of-sample — attenuated (expectancy roughly halves, as expected
    when the in-sample flattering goes away) but clearly positive, not a single-window fluke.
  - Cross-sectional: 6 of 7 symbols with a ≥3-trade sample are positive (EURUSD, XAUUSD, ETHUSD,
    USDJPY, AUDUSD, GBPUSD, USDCHF); only NAS100 is mildly negative (−0.17R on 4 trades). The edge
    is broad, not carried by one symbol.
- Honest limits: still one data source and a recent ~2-month window; per-symbol samples are small
  (only AUDUSD individually clears the 12-trade floor). This is robustness evidence, not a
  battle-test — a live-forward log is the next confirmation. Continuation is upgraded from
  "measured-preliminary" to "measured (edge holds OOS + cross-sectionally)"; READYs remain
  size-conservatively candidate-grade until live-forward data accrues.

## 2026-07-26 — acceptance fork: stop auto-hunting a reversal into an accepted breakout
- Owner caught it live: USDCHF was a strong uptrend (daily bullish/strong, HH+HL) with price
  accepted ~100 pips ABOVE the 1W CRT range high (0.80960 → 0.81770), yet the app showed a
  "CRT REVERSAL — USDCHF SHORT" watch (RR 1:12.94) and NO continuation long. Exactly the
  "sweep gördük diye otomatik ters işlem arama" the two-playbook split was meant to end.
- Two root causes, two fixes:
  1. Continuation was silent. It required a FRESH h1 BOS at scan time; in a mature trend price
     is often mid-pullback with no fresh exec BOS (USDCHF h1 lastEvent was undefined), so it
     produced nothing right when it was needed. Fixed: acceptance = a fresh same-direction exec
     BOS OR an established exec trend (HH+HL / LH+LL) with no opposing CHoCH; pullback POI is
     searched from the breakout leg, or a 120-candle window when there is no fresh BOS. The
     daily-trend gate (+h4 confirm) still guards direction. Now USDCHF surfaces a continuation
     LONG.
  2. CRT auto-hunted the counter-trend fade. Added `continuationAcceptanceSuppresses`: on a
     1d/1w anchor, when the daily structural trend is STRONG and OPPOSITE to the reversal AND
     price has closed BEYOND the swept range edge (accepted, not reclaimed), the CRT reversal is
     suppressed (not emitted) — it is continuation territory. Scoped to HTF anchors only (1d/1w);
     4h/1h tactical raids are untouched, so the measured reversal-at-external-liquidity edge (which
     fires on a RECLAIM, price back inside) is preserved — only accepted-through counter-trend
     fades are dropped. Owner-approved (2026-07-26).
- MEASURED on real data (Yahoo+Binance, 60d, all 12 symbols, prod minRR 1.5 + costs) — the
  continuation-trigger fix turned continuation from barely-firing into a real, measurable edge:
  **57 trades, +84.87R, +1.49R expectancy, 54.4% win, PF 4.41, avg RR 2.76, max DD 4R** (was 3
  trades pre-fix). Sample mode (minRR 0.1): 106 trades, +0.63R, 62.3% win, PF 3.06. CRT unchanged
  (suppression only removed accepted-through HTF fades, which were not reaching READY anyway).
  This clears the 30-trade rule on a single 60d pass; multi-period / out-of-sample still pending.
- Tests: 6 new suppression unit tests (`__crtInternals.continuationAcceptanceSuppresses`: HTF-only
  scope, acceptance vs reclaim, with-trend preserved, weak-trend never suppresses). Full suite 237.

## 2026-07-26 — second playbook added: Trend Continuation (separate module, not a CRT flag)
- Owner (from the Codex thread): the system must not be locked to a single "sweep → reversal"
  model. Two distinct playbooks are required: **CRT Reversal** (unchanged — range sweep → reclaim
  → ChoCH → retest → EQ/DOL) and **Trend Continuation** (HTF trend → accepted breakout → pullback
  FVG/OB retest → trend-direction liquidity target). The critical rule: *"we do NOT auto-hunt a
  reversal just because a sweep happened"* — if trend is strong and price accepts beyond the
  breakout it is continuation; only reclaim + structure reversal is CRT. Must be a separate module
  (own direction/entry/target), and the same setup must never appear under two names.
- Build: new `src/lib/strategies/trendContinuation/trendContinuation.strategy.ts` (`strategyId:
  "trend-continuation"`). Gate = HTF trend via `detectStructuralBias` on 1D (+4H confirm); no
  trend ⇒ no signal. Acceptance = execution-TF **BOS in the trend direction** (a CHoCH is reversal
  territory and is rejected — this is the structural mutual-exclusion that guarantees no
  double-count). Entry = retest of the breakout leg's pullback FVG/OB (retest mandatory, consistent
  with the owner's retest rule; a bullish FVG that closed through flips to bearish in the detector,
  so the direction filter already drops violated gaps). Stop beyond POI far edge / protected swing;
  target = next trend-direction external liquidity from `liquidityObjectives`.
- Wiring: `registry.ts` now exports `PLAYBOOK_STRATEGIES = [crt, trend-continuation]`; `scanRuntime`
  runs both over every context and merges into one labeled list (each signal keeps its own
  `strategyId`, ids unique — no double-count). Scanner shows them in **two separate panels**
  ("CRT Reversal" / "Trend Continuation"), the signal detail eyebrow names the playbook, and the
  Telegram READY message states the playbook and drops CRT-only EQ/DOL wording for continuation.
- Verified: 6 new continuation tests (trend gate, BOS-in-trend long, flat=silent, no counter-trend
  long, CHoCH≠continuation, scanContexts dual-playbook + unique ids) + registry test updated; full
  suite **230 tests pass**; production build clean. Live scan (Yahoo proxy) rendered both panels;
  continuation surfaced on the live board earlier (USDCHF, "pullback POI bekleniyor") and otherwise
  shows an honest empty state — continuation needs breakout AND a pullback POI, which is rarer than
  a raid, so the panel is legitimately empty when no trend-continuation setup is live.
- MEASURED on real data (same day): the replay harness already had a generic single-target
  forward-outcome path, so continuation runs through `runMonthlyRuntimeReplay` unchanged. Replay
  worker + Backtest tab now take a `strategyId`, so the owner can replay either playbook (a
  CRT Reversal / Trend Continuation toggle) — this is the repeatable backtest pass, not a one-off.
- First real-data pass (`scripts/measure-continuation.ts`, Yahoo query2 + Binance direct, all 12
  symbols, 60-day window):
  - sample calibration (minRR 0.1, costs off, the same knobs the replay tests use to build a
    sample): **Trend Continuation = 31 trades, +9.88R total, +0.32R expectancy, 80.6% win,
    PF 5.24, max DD 1.03R**. CRT in the same window = 1 ready (retest-mandatory is far more
    selective snapshot-to-snapshot).
  - prod settings (minRR 1.5 + costs, live-bot config): continuation = 3 ready, +2.33R, +0.78R
    expectancy; CRT = 0 ready (consistent with the live board showing CRT as all-WATCH right now).
  - Read: a positive first edge on a sample that clears the 12-trade floor and approaches the
    30-trade rule — encouraging, not conclusive. It is one 60-day pass on Yahoo history, sample
    mode loosens minRR to reach 31 trades, and there is no out-of-sample split yet. Continuation
    READYs stay candidate-grade until a multi-period pass confirms the edge holds at prod minRR.
- Replay pipeline test added (continuation is measurable, single-target, never carries CRT's
  1H-tracking tag). Full suite 231 tests pass.

## 2026-07-24 — crypto now uses real Binance data (Yahoo crypto feed was ~3.8h stale)
- Owner: the app's BTC chart didn't match real BTC. Measured all 12 symbols' Yahoo freshness:
  FX 0–1 min, futures (GC=F/NQ=F) ~10 min — fine — but **all 5 crypto (BTC/ETH/XRP/BNB/SOL) were
  226 min = 3.8 hours stale**, and the price diverged too (Yahoo BTC 63,926 vs real ~64,158).
  CRT setups on crypto were being computed on hours-old, off-market candles.
- Fix: new `binanceProvider` pulls the 5 crypto symbols from `data-api.binance.vision` (Binance's
  geo-unrestricted public market-data endpoint — no key, 24/7 live). `loadMarketFor` routes crypto
  → Binance, everything else stays on Yahoo (already fresh). Any Binance failure falls back to
  Yahoo, so it is never worse than before. Monthly/weekly/4h are aggregated from 1d/1h exactly as
  the Yahoo pipeline does, so the structural engine stays consistent. Proxies added on both the
  Cloudflare worker (`/binance`) and the vite dev server; cloud-scan (Node) fetches direct.
- Post-deploy the worker `/binance` proxy hit **403** — Binance blocks Cloudflare's egress IPs
  (the geo/IP-block risk flagged up front). But `data-api.binance.vision` sends
  `access-control-allow-origin: *`, so the browser can fetch it **directly** cross-origin (the
  user's own IP is not blocked, and there is no CSP). Switched the browser + node to fetch Binance
  directly and removed the now-useless worker/vite `/binance` proxies and the run_worker_first
  entry. cloud-scan (GitHub Actions) also fetches direct.
- Verified: crypto fetches directly from data-api.binance.vision at real prices (BTC 64,159,
  BNB 561.67 — matching the exchange), 10 min fresh, 24 monthly candles (deep enough), FX/metals
  unchanged, console clean. 223 tests pass.
- Separate finding (not fixed here): the `/api/live-markets` cache is ~8 days stale, i.e. the
  GitHub Actions background scan stopped populating it around 2026-07-16. The browser already
  rejects the stale cache and direct-fetches, so charts are live — but the cloud bot's own scan
  cadence needs checking (same CI-health thread as the broken deploy workflow).

## 2026-07-22 — retest-mandatory RE-ENFORCED (a silent regression in b60d381 caught in a CRT-logic audit)
- CRT trade-logic audit (owner: "crt trade ile ilgili eksik var mı"). Most apparent gaps turned
  out to be deliberate, documented choices — OTE is intentionally excluded ("a synthetic OTE is
  not a POI"), and the entry uses the near FVG edge, not a mandatory CE/midpoint. Minor: CRT's
  `cisdConfirmed` is aliased to ChoCH (no independent CISD detector like Silver Bullet has).
- The real finding: the owner-approved, MEASURED rule `retest-mandatory-for-entry` (restored
  2026-07-15 after direct-from-close entries measured −0.46R vs retest-based +0.56R, and live-READY
  −0.14R → +2.62R) had been **silently reverted** in commit b60d381 ("Align CRT live signals and
  replay", 2026-07-20). That commit re-added the `confirmationClose → entryStatus:"confirmed"`
  branch and deleted the comment citing the measurement — so a ChoCH close with no retest was again
  reaching READY (and Telegram), re-admitting the entry type measured to LOSE money. The ledger,
  this changelog, and even the deleted comment all still said retest was mandatory (Master §12
  violation).
- Fix (owner decision this session): `selectCrtEntry` ignores `confirmationClose` again — a ChoCH
  close stays PENDING/WATCH until price actually retests. Stale/contradictory warning texts fixed;
  the now-unreachable "confirmed without retest" warning replaced with the pending-retest note.
  Test updated to lock retest-mandatory. Verified on live data: **0 signals confirmed-without-retest**;
  ChoCH setups correctly wait at poi-retest. 220 tests pass.

## 2026-07-22 — the last two doctrine gaps closed: §6 lifecycle implemented, §8 direction MEASURED
**§6 — the 10-state lifecycle now exists.** `setupPhase` only ever had 4 states
(context/raid/model/ready) against Master §6's ten. New `lifecycleState` derives the full chain
deterministically from facts the system already owns — CANDIDATE → ACTIVE_RANGE → SIDE_SWEPT →
RETURNED_INSIDE → CONFIRMATION_PENDING → CONFIRMED → TARGETING_MIDPOINT /
TARGETING_OPPOSITE_EXTREME → INVALIDATED / COMPLETED. Since there is no position tracking, the
TARGETING_* states are read honestly from where price sits relative to entry and EQ. Exposed on
`crtAnchor.lifecycleState` and as a `crt-lifecycle` evidence item (Master §9), so Gemini and the
UI see the whole chain instead of "ready or not". `setupPhase` stays for sorting/UI compatibility.

**§8 — direction source: measured, not flipped.** Master §8 says the two-sided bias engine
establishes direction before the CRT evaluation; the code resolves direction per anchor and lets
the bias engine only dock score. This is NOT an undocumented violation — the ledger rule already
said the bias "does NOT override the per-anchor direction resolution **yet**", and the
anchor-owns-direction rule itself came from a measured failure (a global PD read once painted
every correlated pair the same side).
- Rather than reverse a measured decision on doctrine grounds, the open "yet" is now instrumented:
  every replay trade is tagged `bias:opposes` / `bias:not-opposing` and a `bias-not-opposing`
  filter scenario reports what gating on bias would do.
- **First real-data reading: all READY = 8 trades, 0.36R, PF 2.44, 2.89R; bias-not-opposing =
  7 trades, 0.25R, PF 1.88, 1.76R.** The single trade whose bias opposed the anchor returned
  **+1.13R** — gating on bias would have deleted a winner and lowered expectancy. Evidence
  supports keeping direction anchor-resolved. Sample is one opposing trade, so this is a first
  reading, not a verdict; revisit at the 30+ trade review via the scenario line.
- 220 tests pass.

## 2026-07-22 — the HTF veto is finally IN FORCE, and the duplicate gate that starved it is gone
- Follow-up to the structural-bias work. The owner-approved rule `htf-alignment-loose` says an
  actively opposing higher timeframe vetoes READY — but `useHtfAlignmentFilter` defaulted to
  **false** in both defaultRules and crtStrategy.defaultSettings, so the rule was documented and
  never enforced (Master §12 violation). A code comment even claimed "htfAlignment already vetoes
  a hard opposing HTF", which was false under the shipped default. Both defaults are now `true`.
- Measured first, on real Yahoo data: veto on vs off produced **identical** results (same trades,
  R, PF, WR, DD). Reason: the new structural bias returns neutral ~17.5% of the time (drift: 0%),
  and the loose gate tolerates neutral, so "actively opposing" is now rare. Enabling it costs
  nothing in this window and brings code in line with the rule — but note the veto simply never
  fired here, so this is "no measured downside", not proof it is harmless in every regime.
- **Removed the duplicate HTF gate from `applyRules`.** Two problems, both measured:
  (1) it had no `reversalAtExternalHtf` exception, so turning the flag on would have silently
  broken the owner's reversal-at-external-liquidity rule (the USDCHF case);
  (2) it hid **12 of 18 visible signals (67%)** — precisely the "scoring the same thing twice
  starves the live system" failure this repo already learned once. The gate now lives only in the
  strategy, where the exception exists. After removal, visible signals stay at 18 with the veto on.
- Also fixed: the replay worker never received `useHtfAlignmentFilter`, so the Ayar toggle changed
  live scanning but not the replay — the measurement tool was blind to the very setting under test.
  219 tests pass.

## 2026-07-22 — structural HTF bias replaces drift; 1H anchor DEMOTED on real-data evidence
**A. HTF bias is now market structure, not close drift.**
- `detectBias` (8-candle close-to-close drift, kept as `detectDriftBias` for comparison) was the
  single source of every HTF direction surface: the alignment chain, `directionalBias.htfStructure`
  (25p — heaviest bias input), `htfNarrative`, and the score bonus. It read direction from
  `last.close > first.close` — no swings, no BOS/CHoCH, and it could essentially never return
  neutral (only on exact float equality). Master §3/§8 require structure and an honest neutral.
- New `detectStructuralBias`: wing-confirmed swings → HH/HL/LH/LL → protected high/low →
  BOS vs CHoCH → real neutral on broadening/contracting ranges and on insufficient structure.
  A pullback-free impulse leg (no pivots) is still read as a trend via a range-position fallback,
  so clean trends are not mislabelled unclear. No repaint: unclosed candles ignored, break scans
  start only after a swing is knowable.
- Real-data check (8 symbols × 5 TFs): drift **0% neutral**, structural **17.5% neutral**, the two
  disagree on **42.5%** of reads. Representative fix: `XAUUSD daily — drift said bullish while
  structure was LH + LL (textbook downtrend)`. That false read costs up to 12 score points, which
  can drop a setup a whole grade (A→B = 0.85→0.55 risk) — a direct, quantifiable R leak.
- **Equal highs/lows (EQH/EQL) added** — Master §3's primary liquidity pool was completely absent.
  Unswept equal swing levels (strength by touch count) now feed the external-draw component.
- Measured effect on the core: **0.33R → 0.36R expectancy, PF 2.15 → 2.44, WR 71.4% → 75.0%,
  2.30R → 2.89R** (8 trades — small sample, but every metric moved the right way).

**B. The 1H anchor promotion is REVERSED — real data contradicted the demo window.**
- Promoted to live earlier today on a demo-window result (7/9 triggers, PF 2.94, +3.87R). On real
  Yahoo data, measured in the SAME replay window as the core (clean comparison):
  **1H = 5/7 triggers, −0.55R/trade, PF 0.31, WR 20%, −2.77R** while the core was +2.89R. With 1H
  live the headline collapsed to 0.01R expectancy / PF 1.02 / WR 53.8% / max DD 3.00R.
- `intradayAnchorMode` default returned to `"tracking"`: the 1H family is watch-only again, pages
  nobody, and keeps accumulating shadow evidence. This is the 30-trade rule vindicating itself —
  the demo result was exactly the small-sample illusion it exists to catch. Re-promotion needs 30+
  real tracked trades that actually hold up. 219 tests pass.

## 2026-07-22 — 1H anchor PROMOTED TO LIVE (owner decision, 30-trade rule consciously overridden)
- `intradayAnchorMode` default flipped from "tracking" to "live": the 1H→5M anchor now produces
  READY signals and pages Telegram through the same quality gates as every other anchor
  (RANGE_TF_RANK keeps it sorted last, so it only surfaces when it is the best available signal).
- **This overrode the owner's own 30-trade rule.** As CRT expert I recommended AGAINST promoting
  on a single demo-window result (7/9 triggers, PF 2.94) and spelled out the real-money risk; the
  owner explicitly chose to promote now ("Şimdi canlıya terfi et"). Both the recommendation-against
  and the decision are on record — the owner owns the call. Revert with `intradayAnchorMode:
  "tracking"` to demote.
- Replay now mirrors the live reality: in live mode 1H joins the headline metrics; only in
  tracking mode is it shadow-measured off the headline (partition made conditional on the setting).
  New tests: watch-only under explicit tracking, first-class family under the live default,
  anchor:1h tag stays tracking-only. 209 tests pass; live scan verified (1H setups surface, ready-
  eligible, console clean).
- **Watch closely:** the promotion rests on demo-window data, not 30 real trades. If live 1H
  results underperform, demote back to tracking.

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
