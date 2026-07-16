# CRT Session Architecture

```text
OHLC
  -> IANA timezone normalization
  -> versioned session profile
  -> stateful session occurrence/range
  -> locked range and trading-day identity
  -> session interaction classifier
  -> existing CRT evidence and READY signal
  -> CRT_SESSION setup lifecycle
  -> separate local setup/log store
  -> Session workspace
  -> validated Gemini interpretation
```

## Modules

- `src/lib/session/timezone.ts`: local session boundaries to UTC and DST round-trip checks.
- `src/lib/session/profiles.ts`: versioned symbol/asset profiles.
- `src/lib/session/sessionRangeEngine.ts`: occurrences, building/locked/expired ranges and quality.
- `src/lib/session/sessionConfluenceEngine.ts`: sweep/reclaim versus acceptance, scoring and lifecycle.
- `src/lib/session/sessionSetupStore.ts`: separate idempotent persistence.
- `src/lib/session/sessionAnalysis.ts`: deterministic Gemini payload and response validation.
- `src/components/SessionSetupsView.tsx`: compact setup list, evidence chain, range map and logs.

## Persistence

The current static application stores:

- `tradebot.crtSessionSetups.v1`
- `tradebot.crtSessionSetupLogs.v1`

These keys are separate from the trade journal. A future server implementation can expose the same contracts at `/api/session-setups`, `/api/session-ranges`, `/api/session-status` and `/api/session-statistics`.

## No-Lookahead Rules

- A range only reads candles whose timestamp is inside its occurrence and not after analysis time.
- A locked range ignores later candles.
- A setup cannot be confirmed by session touch alone.
- Gemini cannot detect or alter events.
