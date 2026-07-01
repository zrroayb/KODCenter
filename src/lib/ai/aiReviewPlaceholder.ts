import type { AiReviewRequest, AiReviewResult } from "./types";

export function aiReviewPlaceholder(request: AiReviewRequest): AiReviewResult {
  const weakness = request.warnings[0] ?? "no major weakness flagged";
  return {
    summary: `Deterministic review: setup is assessed from reasoning, risk behavior and rule alignment. Main weakness is ${weakness}.`,
    externalApiUsed: false
  };
}
