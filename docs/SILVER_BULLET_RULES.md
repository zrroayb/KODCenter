# Silver Bullet Rules — User-Approved (human-readable)

Machine-readable source: [`knowledge/user_rules/silver_bullet_rules.json`](../knowledge/user_rules/silver_bullet_rules.json).
Governing doc: [`docs/SILVER_BULLET_MASTER_INSTRUCTION.md`](./SILVER_BULLET_MASTER_INSTRUCTION.md).
Strategy config: [`knowledge/strategies/ny_am_09_range_v1.json`](../knowledge/strategies/ny_am_09_range_v1.json).

- **Reference candle** — the completed 09:00–10:00 America/New_York H1 (built from validated
  intraday bars, DST-safe, locked at 10:00, never repainted). Incomplete data → NO_TRADE.
- **Window** — entries only 10:00–11:00 NY and the entry must **fill** before 11:00; a signal
  without a fill is EXPIRED/NO_TRADE. At 11:00 unfilled orders cancel.
- **Sequence (all mandatory)** — sweep of one side → failure to accept outside → reclaim →
  displacement → MSS or CISD → valid FVG entry array → stop at sweep extreme + buffer →
  opposite-side target with acceptable R:R.
- **Acceptance ≠ reversal** — multiple closes outside with no reclaim = BREAK_ACCEPTED_OUTSIDE,
  setup rejected. Both sides swept before entry = rejected (the opposite extreme IS the target).
- **HTF = BIAS_SCORED** — agreement adds score, conflict subtracts and is displayed; the
  mechanical trigger is never silently blocked.
- **Separate family** — `ICT_SILVER_BULLET` labels/lifecycle/logs (`SILVER_BULLET_SETUP`)/UI/
  stats; never merged into CRT or CRT_SESSION.
- **Configurable initial values** (reference backtest): displacement body/range 0.70 & body
  1.5×ATR, FVG ≥ 0.3×ATR, min R:R 2.5, BE at 3R, stop buffer 0.25×ATR, 1 fill/symbol/day.
- **Gemini** — interpret-only, structured JSON, may only cite provided event ids, can never
  approve a post-11:00 fill (validated client- and server-side).
