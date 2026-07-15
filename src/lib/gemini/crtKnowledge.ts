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
  { id: "crt-reference-range", title: "CRT reference range", applies: "any", text: "A CRT reference candle is a completed HTF candle whose high and low define a meaningful range. It must be important — a body-dominant/imbalance candle at meaningful liquidity — not just any large or latest candle." },
  { id: "liquidity-sweep", title: "Liquidity sweep vs breakout", applies: "any", text: "A valid sweep trades beyond a meaningful level, fails to accept there, and returns inside (or shows strong rejection). A wick through a level with acceptance beyond it is a breakout, not a sweep." },
  { id: "sellside-sweep-bullish", title: "Sell-side sweep → bullish", applies: "bullish", text: "For a bullish CRT the reference LOW is swept, price fails to accept below, then reclaims. The swept sell-side liquidity is the fuel; the draw is buy-side liquidity above." },
  { id: "buyside-sweep-bearish", title: "Buy-side sweep → bearish", applies: "bearish", text: "For a bearish CRT the reference HIGH is swept, price fails to accept above, then reclaims. The swept buy-side liquidity is the fuel; the draw is sell-side liquidity below." },
  { id: "return-inside", title: "Return inside the range", applies: "any", text: "After the sweep, price must return and hold inside the reference range. Acceptance outside (a decisive close beyond the swept extreme) invalidates the CRT." },
  { id: "displacement", title: "Displacement", applies: "any", text: "Meaningful repricing after the sweep: a fast body-dominant candle, ideally leaving a fair value gap. Larger-than-previous alone is not displacement; it needs intent and follow-through." },
  { id: "mss-choch", title: "MSS / ChoCH confirmation", applies: "any", text: "The change of character is the FIRST close through the protecting swing, immediately after the sweep. A later re-close of the same level is the new trend's continuation (BOS), not this raid's ChoCH." },
  { id: "premium-discount", title: "Premium / discount", applies: "any", text: "Discount (below equilibrium) favours longs; premium favours shorts. Location refines probability but never sets direction on its own." },
  { id: "discount-long", title: "Discount for longs", applies: "bullish", text: "A bullish CRT is higher quality when the entry sits in the discount half of the dealing range; buying in premium is a quality penalty." },
  { id: "premium-short", title: "Premium for shorts", applies: "bearish", text: "A bearish CRT is higher quality when the entry sits in the premium half of the dealing range; selling in discount is a quality penalty." },
  { id: "opposite-side-delivery", title: "Delivery target", applies: "any", text: "After confirmation, price delivers toward the range midpoint (equilibrium/EQ) first, then the opposite reference extreme or external liquidity. The opposite bound / candle-open level is a classic CRT target." },
  { id: "external-draw", title: "External draw on liquidity", applies: "any", text: "The likely draw is the strongest UNSWEPT external liquidity (previous day/week high or low, equal highs/lows). The nearest level is not automatically the draw — structure and whether a target already got swept decide." },
  { id: "reference-candle-quality", title: "Reference-candle quality", applies: "any", text: "Grade the range candle: imbalance body/range, size vs ATR (not noise, not exhausted), expansion, meaningful location, session. A weak/arbitrary candle is a low-quality range even if the sweep looks clean." },
  { id: "turtle-soup", title: "Turtle Soup", applies: "any", text: "A three-candle stop-run pattern (range → purge/reclaim with a long wick and midpoint respected). It is manipulation evidence, not a standalone entry — entry still comes from ChoCH/POI." }
];

// Retrieve 3–8 relevant records for a setup: the core sequence plus the direction-specific ones.
export function retrieveCrtKnowledge(input: { direction: TradeDirection; hasTurtleSoup?: boolean; limit?: number }): CrtKnowledgeRecord[] {
  const side = input.direction === "long" ? "bullish" : "bearish";
  const limit = Math.max(3, Math.min(8, input.limit ?? 7));
  const coreIds = ["crt-reference-range", "liquidity-sweep", "return-inside", "displacement", "mss-choch", "external-draw", "opposite-side-delivery", "reference-candle-quality"];
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
