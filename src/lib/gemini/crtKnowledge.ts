import type { TradeDirection } from "../ict/types";

// Master §11/§16: a compact, in-repo CRT knowledge base. Original concise definitions (concepts
// are not copyrightable; grounded in the community CRT sources studied under references/). The
// retriever hands Gemini only the 3–8 records relevant to the current setup — never the whole
// base — so interpretation is grounded without flooding the prompt.

export type CrtKnowledgeRecord = {
  id: string;
  title: string;
  applies: "any" | "bullish" | "bearish";
  text: string;
};

export const CRT_KNOWLEDGE: CrtKnowledgeRecord[] = [
  // ---- CRT Secrets playlist (2026-10-02): the owner's reference source. These rules win over the
  // older generic records below when they differ.
  { id: "three-candle-cycle", title: "Three-candle cycle", applies: "any", text: "CRT is a three-candle cycle on the range timeframe. Candle 1 (accumulation) defines the range by its WICK high/low and its 50% EQ. Candle 2 (manipulation) wicks beyond ONE extreme and closes back inside. Candle 3 (distribution) is the only candle that is traded — never enter while Candle 2 is still open. A close beyond the range (acceptance) or an outside bar is not a CRT." },
  { id: "key-level-required", title: "Key level is mandatory", applies: "any", text: "A CRT is only valid at a key level: an old HTF high/low (PDH/PDL, PWH/PWL, PMH/PML), an HTF fair value gap, or a candle open price. A CRT shape without a key level is pattern-trading, not a setup — do not trade it." },
  { id: "htf-bias-required", title: "HTF trend is mandatory", applies: "any", text: "Trade a CRT only in the direction of the higher-timeframe trend. A bearish CRT in an up-trending market, or a bullish CRT in a down-trend, is forbidden — there is no counter-trend exception." },
  { id: "confirmation-models", title: "Confirmation, entry and stop", applies: "any", text: "Lower-timeframe confirmation: Model #1 — after the thick candle that pierced the extreme, an opposite BODY close back inside; or True MSS — after the sweep's lower low, a close above the high that preceded it (mirror for shorts). An FVG at the shift or SMT divergence with a correlated pair raises probability. Entry: at the Model #1 close, or on the retest of the FVG/OTE (62-79%) after the MSS. Stop: just beyond the sweep (turtle soup) extreme." },
  { id: "crt-targets", title: "Targets", applies: "any", text: "Target 1 is the range EQ (50%): take profit and/or move the stop to break-even there — reaching EQ means the setup worked. Target 2 is the opposite range extreme (the DOL). An opposing SMT with a reversal structure on the way cancels the remaining target. If price already traded to the EQ after the raid and before the entry, the setup is consumed: no new entry." },
  { id: "timeframe-pairing", title: "Range and model timeframes", applies: "any", text: "Range timeframe -> model timeframe: 1M -> 1D, 1W -> 4H, 1D -> 1H or 15m. The HTF range levels are carried unchanged onto the lower-timeframe chart, where the confirmation and entry are taken." },
  { id: "weekly-timing", title: "Weekly timing", applies: "any", text: "Weekly cycle: Monday often prints a fake high/low, Tuesday/Wednesday the true weekly high or low (turtle soup), Thursday/Friday the expansion to the opposite side. There is no fixed mechanical candle-hour rule (such as 4H 1/5/9 opens)." },
  // ---- Older generic records (kept where they do not contradict the source above).
  { id: "crt-reference-range", title: "CRT reference range", applies: "any", text: "A CRT reference candle is a completed HTF candle whose high and low define a meaningful range. It must be important — a body-dominant/imbalance candle at meaningful liquidity — not just any large or latest candle." },
  { id: "liquidity-sweep", title: "Liquidity sweep vs breakout", applies: "any", text: "A valid sweep trades beyond a meaningful level, fails to accept there, and returns inside (or shows strong rejection). A wick through a level with acceptance beyond it is a breakout, not a sweep." },
  { id: "sellside-sweep-bullish", title: "Sell-side sweep → bullish", applies: "bullish", text: "For a bullish CRT the reference LOW is swept, price fails to accept below, then reclaims. The swept sell-side liquidity is the fuel; the draw is buy-side liquidity above." },
  { id: "buyside-sweep-bearish", title: "Buy-side sweep → bearish", applies: "bearish", text: "For a bearish CRT the reference HIGH is swept, price fails to accept above, then reclaims. The swept buy-side liquidity is the fuel; the draw is sell-side liquidity below." },
  { id: "return-inside", title: "Return inside the range", applies: "any", text: "After the sweep, price must return and hold inside the reference range. Acceptance outside (a decisive close beyond the swept extreme) invalidates the CRT." },
  { id: "displacement", title: "Displacement", applies: "any", text: "Meaningful repricing after the sweep: a fast body-dominant candle, ideally leaving a fair value gap. Larger-than-previous alone is not displacement; it needs intent and follow-through." },
  { id: "mss-choch", title: "MSS / ChoCH confirmation", applies: "any", text: "The change of character is the FIRST close through the protecting swing, immediately after the sweep. A later re-close of the same level is the new trend's continuation (BOS), not this raid's ChoCH." },
  { id: "premium-discount", title: "Premium / discount", applies: "any", text: "Discount (below equilibrium) favours longs; premium favours shorts. Location refines probability but never sets direction on its own." },
  { id: "discount-long", title: "Discount for longs", applies: "bullish", text: "Inside the CRT's OWN range a long entry must sit in discount (below the range EQ) — the engine blocks a long entered in the range's premium. The wider dealing range's premium/discount is only a quality note." },
  { id: "premium-short", title: "Premium for shorts", applies: "bearish", text: "Inside the CRT's OWN range a short entry must sit in premium (above the range EQ) — the engine blocks a short entered in the range's discount. The wider dealing range's premium/discount is only a quality note." },
  { id: "external-draw", title: "External draw on liquidity", applies: "any", text: "The likely draw is the strongest UNSWEPT external liquidity (previous day/week high or low, equal highs/lows). The nearest level is not automatically the draw — structure and whether a target already got swept decide." },
  { id: "reference-candle-quality", title: "Reference-candle quality", applies: "any", text: "Grade the range candle: imbalance body/range, size vs ATR (not noise, not exhausted), expansion, meaningful location, session. A weak/arbitrary candle is a low-quality range even if the sweep looks clean." },
  { id: "turtle-soup", title: "Turtle Soup", applies: "any", text: "A three-candle stop-run pattern (range → purge/reclaim with a long wick and midpoint respected). It is manipulation evidence, not a standalone entry — entry still comes from ChoCH/POI." }
];

// Retrieve 3–8 relevant records for a setup: the core sequence plus the direction-specific ones.
export function retrieveCrtKnowledge(input: { direction: TradeDirection; hasTurtleSoup?: boolean; limit?: number }): CrtKnowledgeRecord[] {
  const side = input.direction === "long" ? "bullish" : "bearish";
  const limit = Math.max(3, Math.min(8, input.limit ?? 8));
  // Source rules first (CRT Secrets), then the older generic sequence if room is left.
  const coreIds = ["three-candle-cycle", "key-level-required", "htf-bias-required", "confirmation-models", "crt-targets", "timeframe-pairing", "return-inside", "external-draw", "reference-candle-quality"];
  const picked: CrtKnowledgeRecord[] = [];
  const push = (record?: CrtKnowledgeRecord) => {
    if (record && !picked.some((item) => item.id === record.id) && picked.length < limit) picked.push(record);
  };
  const byId = (id: string) => CRT_KNOWLEDGE.find((record) => record.id === id);
  // Direction-specific first so they survive the cap, then the core sequence.
  push(byId(side === "bullish" ? "sellside-sweep-bullish" : "buyside-sweep-bearish"));
  push(byId(side === "bullish" ? "discount-long" : "premium-short"));
  if (input.hasTurtleSoup) push(byId("turtle-soup"));
  for (const id of coreIds) push(byId(id));
  return picked;
}
