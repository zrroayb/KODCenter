# CRT Session Audit

Date: 2026-07-16

## Existing Application

1. Strategy registry: CRT is the active strategy; KOD remains legacy only.
2. Timeframes: 1W->4H, 1D->1H and 4H->15m anchors exist.
3. CRT range logic: reference, active CRT and FVG-origin anchors exist.
4. Confirmation: ChoCH plus retest is mandatory for existing CRT READY.
5. Risk: structure/manipulation stop and DOL targets exist.
6. Management: the approved primary replay model exits the full position at EQ/TP1.
7. HTF policy: neutral is tolerated; dominant opposing HTF blocks, except validated external-liquidity reversals.
8. Session clock: IANA-aware display existed, but it was not a deterministic range engine.
9. Session data: no locked session object, trading-day identity, range quality or expiry existed.
10. Session setups: no separate `CRT_SESSION` family or lifecycle existed.
11. Logging: trade journal existed, but session setup logs had no separate namespace.
12. Idempotency: generic alert memory existed; session lifecycle transitions were not deduped.
13. Gemini: CRT evidence IDs were validated, but no session-specific payload/schema existed.
14. Replay: generic session tags existed, but reference-session/trigger-session/model breakdown did not.
15. UI: there was no Session Setups workspace.
16. DST: display conversion used IANA zones, but session occurrence construction was based on derived UTC hours.
17. Midnight sessions: display supported UTC wrapping, but stable cross-midnight trading-day IDs did not exist.
18. Calendars: there is no production exchange-holiday service in this static Vite architecture.
19. Storage: the app has no server database; local storage is the safe persistence boundary today.
20. Deployment: Vite dev/preview middleware is the current API proxy for Yahoo, Telegram and Gemini.

## Reference Repository Decisions

| Repository | Decision | Reason |
| --- | --- | --- |
| `smart-money-concepts` | REFACTOR / REFERENCE | Useful FVG, liquidity and structure semantics. Session code relies on fixed offsets and is not the production timezone layer. |
| `HTF-Po3` | REFERENCE ONLY | Useful lifecycle and alert ideas. Pine session/DST choices are partly manual. No reusable production license found in the checked copy. |
| `crt-turtlesoup-ea` | REFERENCE ONLY | Closed-bar dedupe is useful. Fixed Turtle Soup rules are not the approved hard gate. No reusable license found. |
| `fxtt-mt5-session-high-low` | REFERENCE ONLY | Range locking and midnight handling are useful. Manual broker GMT offset is rejected as primary architecture. |
| `ORB-Multi-Model-Indicator` | REFERENCE ONLY | Model separation and scoring are useful. ORB logic must not replace CRT. No reusable license found. |
| `pandas_market_calendars` | FUTURE BACKEND REFERENCE | Strong calendar source, but not suitable for direct browser bundling. |
| `exchange_calendars` | FUTURE BACKEND REFERENCE | Strong exchange schedule source, but not suitable for direct browser bundling. |
| `tzdata` | AUTHORITATIVE REFERENCE | IANA timezone data source. Runtime uses platform `Intl` IANA data. |
| `python-genai` | REFERENCE | Structured response schema, retry and validation patterns. Current app uses a Vite proxy, not Python. |
| `ict-knowledge-library` | REFERENCE ONLY | Useful terminology curation. No reusable license found; no source text is copied into the product. |

## Preserved Owner Decisions

- Session is confluence and context, not an automatic veto.
- Crypto sessions are not hard entry gates.
- SMT remains a quality factor, not a hard gate.
- A CRT mitigating candle does not need an extra HTF close; LTF confirmation owns the entry decision.
- A CRT range consumed to or beyond 50% is not chased.
- Retest remains mandatory for the existing CRT READY flow.
- Full exit at EQ/TP1 remains the primary replay management model.

## Remaining Boundary

Exchange holidays and early closes require a backend calendar adapter. The current implementation records calendar uncertainty as a warning boundary rather than inventing exchange status in the browser.
