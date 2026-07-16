# CRT Session Rules

`CRT_SESSION` is a separate setup family. It combines deterministic session ranges with the existing CRT evidence engine.

## Sequence

1. Build a session range in its canonical IANA timezone.
2. Lock the range when the configured session ends.
3. Carry the locked range only into its configured trigger session.
4. Classify interaction as sweep and reclaim, or break and acceptance.
5. Require directional displacement.
6. Require the existing CRT lower-timeframe confirmation for `CONFIRMED`.
7. Reject dominant HTF conflict, unresolved two-sided sweeps, stale entries and exhausted targets.

A level touch is never confirmation. A low sweep is not automatically bullish. A high sweep is not automatically bearish.

## Enabled Models

- Asia range to London sweep reversal.
- Asia range to London accepted breakout continuation.
- London range to New York AM sweep reversal.
- London expansion to New York continuation.
- Previous-day high/low sweep during London, New York AM or New York PM.
- Existing previous-HTF CRT high/low sweep during an enabled trigger session.

The data contracts also reserve labels for NY opening manipulation, overlap and London Close. London Close and overlap are disabled by default until replay evidence supports them.

## Score

The score is 0-100 and is composed of HTF alignment, range quality, liquidity meaning, sweep, reclaim, displacement, CRT quality, LTF confirmation, target and timing. Penalties are explicit.

## Lifecycle

`CANDIDATE -> RANGE_LOCKED -> WAITING_FOR_SWEEP -> WAITING_FOR_RECLAIM -> WAITING_FOR_DISPLACEMENT -> WAITING_FOR_LTF_CONFIRMATION -> CONFIRMED`

Terminal states are `INVALIDATED`, `LATE`, `EXPIRED` and `COMPLETED`.
