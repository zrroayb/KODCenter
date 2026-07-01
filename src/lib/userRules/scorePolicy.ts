export const MIN_VISIBLE_SIGNAL_SCORE = 50;

export function effectiveMinimumScore(minimumScore: number) {
  return Math.max(MIN_VISIBLE_SIGNAL_SCORE, minimumScore);
}
