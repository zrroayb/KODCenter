# Trade Style Backup and CRT Master Framework

Status: canonical live strategy reference  
Framework version: `crt_secrets_pdf_v1`  
Source document: `CRT Secrets Series - Book`  
Source subject: `Candle Range Theory Technical Guide`  
Source pages: `86`  
Source SHA256: `e0f62372112170ada2f78ba79f3954ddd11eda68a8889b5964a0bde47e1c4ae6`  
Runtime rule: live scanner, Desk, Telegram, and charts must use the Canonical Live Framework below.

## Legacy Backup

Historical backup only. This section records the prior live style so it is not lost. It is not the live decision source after `crt_secrets_pdf_v1`.

Prior profiles:

- `swing`: `1d` context into `1h` trigger.
- `intraday`: `4h` context into `15m` trigger.

Prior live gate:

- HTF/context bias and same-direction liquidity objective had to align.
- The profile context candle had to print a Context CRT raid/reclaim.
- The trigger timeframe had to confirm with MSB or iFVG reclaim.
- Fresh same-direction FVG displacement was confluence only.
- Alerts and Desk `READY` state were blocked when Context CRT or trigger confirmation was missing.
- TP1 was planned at `1R`; TP2 came from internal liquidity, FVG/iFVG midpoint, range edge, or minimum RR fallback; final target was the HTF draw.

Compatibility notes:

- Existing `raid_*`, `htf_raid_candle`, and `context_crt` payload fields may remain for old UI/data compatibility.
- The old style can be read for audit and debugging, but it must not be used to approve a live trade.

## Canonical Live Framework

The live system follows the CRT Secrets PDF as a strict, ordered checklist. Entry is the final step, never the first step.

### 1. HTF Narrative

- Start from the big picture: monthly and weekly first, then daily and 4H.
- Trade only with the main direction. Counter-narrative trades are blocked.
- For live code, the candidate direction must be accepted by available HTF structure:
  - Monthly and weekly are the strongest narrative inputs when present.
  - Daily and 4H must not directly fight the selected direction.
  - If enough HTF data is unavailable, the live system marks the narrative as unavailable and does not promote the setup to `READY`.

### 2. Key Level

CRT patterns only matter at important levels. A candidate must form around one of:

- Old swing high or swing low.
- Equal high or equal low liquidity.
- `PDH`, `PDL`, `PWH`, `PWL`, `PMH`, or `PML`.
- A strong liquidity pool from the framework map.

No key level means no trade, even if a lower-timeframe trigger appears.

### 3. CRT Range and Three-Candle Cycle

Every valid setup is interpreted through the CRT cycle:

- Candle 1: accumulation or range candle. This defines the working range and objective.
- Candle 2: manipulation candle. This creates the turtle soup, stop run, or liquidity grab.
- Candle 3: distribution candle. This is the only candle the live system is allowed to trade.

Candle 2 is context only. The live system must not alert or mark `READY` from Candle 2 alone.

### 4. Turtle Soup and KOD

The manipulation leg must take liquidity and reclaim it:

- Bullish setup: price raids below an old low or sell-side key level, then reclaims.
- Bearish setup: price raids above an old high or buy-side key level, then reclaims.
- KOD is treated as the final turtle soup before the mapped target.
- Stop placement must be beyond the turtle soup/manipulation extreme plus buffer.

### 5. Candle 3 Confirmation

Only Candle 3 confirmation can approve a live setup:

- `trigger_mode: "model1"`: Model #1 candle. One exact trigger candle liquidates the old high/low and closes back through the key level.
- `trigger_mode: "mss"`: true market structure shift/MSB after the manipulation leg.

Invalid confirmations:

- `trigger_mode: "fvg"` is not a valid entry trigger.
- iFVG/FVG is not a valid entry trigger by itself.
- A fresh FVG displacement can support quality, target mapping, or narrative, but cannot make a setup live.

### 6. Confluence

The minimum confluence stack for `READY`:

- HTF narrative aligned.
- Key level present.
- Candle 2 turtle soup/manipulation completed.
- Candle 3 Model #1 or MSS confirmed.
- FVG location supports the direction.
- Session is London or New York killzone.
- Risk and target map are valid.

SMT policy:

- If SMT feed is unavailable, show `SMT unavailable` and do not block only because of that.
- If SMT feed exists and opposes the setup, block the setup.
- If SMT feed exists and aligns, treat it as confluence.

### 7. Risk and Targets

- Default risk guidance remains manual: risk no more than 1 percent by default and 2 percent maximum.
- Stop must sit beyond the manipulation extreme.
- TP1 is the 50 percent mission target between entry and final CRT objective.
- Final target is Candle 1 high/low or the selected CRT liquidity objective.
- A setup with weak or unavailable target room cannot be promoted to `READY`.
- A Plan B must be available: invalidation, opposite scenario, and stand-down condition.

## Runtime Contract

The live payload must expose the sequence clearly:

- `framework_version`
- `source_document`
- `htf_narrative`
- `key_level`
- `crt_phase`
- `candle_1`
- `candle_2`
- `candle_3`
- `model1_trigger`
- `mss_trigger`
- `fvg_confluence`
- `smt_status`
- `session_gate`
- `target_50`
- `plan_b`

Desk checklist labels:

- `HTF narrative`
- `Key level`
- `Candle 2 Turtle Soup`
- `Candle 3 Model #1/MSS`
- `FVG`
- `Session`
- `Risk`

Hard rule: no alert, actionable Telegram, Desk `READY`, or priority-visible card unless every blocking gate passes.
