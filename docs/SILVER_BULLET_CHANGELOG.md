# Silver Bullet Changelog

Newest first.

## 2026-07-16 — NY_AM_09_HOURLY_RANGE_REVERSAL_V1 v1 shipped
- Phase 1 audit written to `SILVER_BULLET_ARCHITECTURE.md`; governance persisted
  (master instruction, rules ledger, strategy profile config). Reference repos cloned
  (Silver-Bullet-AM-Session has NO licence → REFERENCE ONLY; parameters adopted as
  configurable initial values: body/range 0.70, body 1.5×ATR, FVG 0.3×ATR, min R:R 2.5,
  BE 3R, stop buffer 0.25×ATR).
- Deterministic engine: DST-safe 09:00–10:00 NY reference builder (validated, locked,
  never repainted) + 10:00–11:00 window state machine (sweep metrics → reclaim vs
  acceptance → displacement → MSS + explicit CISD → FVG entry array → strict
  fill-before-11:00 → stop/targets/R:R → §24 scoring → §9 lifecycle → §21 NO_TRADE
  reasons). Both-sides/target-already-delivered gate applies on every exit path.
  CISD audit: no detector existed anywhere; explicit definition implemented (close
  through the origin OPEN of the delivery series into the sweep).
- Separate logging: namespace SILVER_BULLET_SETUP, idempotent store + lifecycle logs
  (localStorage, mirrors the session-store reconcile pattern). No CRT/session pollution.
- Gemini: `/api/gemini/silver-bullet-analysis` on vite dev/preview AND the Cloudflare
  worker — §33 system instruction + §34 schema; validation rejects invented event ids,
  unsupported profiles and any approval whose entry did not fill before 11:00 NY
  (guarded both client- and server-side).
- UI: Session Setups tab gained family tabs (CRT × Session | Silver Bullet); SB section
  shows NY clock + window countdown, per-symbol setups (reference range, quality, swept
  side, trigger, score/grade, lifecycle), detail with plan/no-trade reasons/evidence/
  lifecycle logs and on-demand Gemini interpretation.
- Tests: 15 new (reference build/lock/no-repaint, DST Jan-vs-Jul, incomplete data,
  bearish confirm with MSS/CISD+FVG+fill, acceptance-outside reject, both-sides reject,
  no-sweep NO_TRADE, strict-deadline EXPIRED, BIAS_SCORED conflict warning, idempotent
  logs, Gemini contract incl. post-11:00 veto). Suite: 187 tests, build + worker clean.
- Verified live in the app: 12 symbols rendered with real 09:00 NY ranges, honest
  NO_TRADE/no-sweep/accepted-outside lifecycles, window state correct vs NY clock.
- Data note: Yahoo provides M5 as the finest series — executionTf is configurable; M1
  becomes a config change when a provider is available.
