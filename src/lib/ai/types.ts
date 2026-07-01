export type AiReviewRequest = {
  reasoning: string;
  warnings: string[];
};

export type AiReviewResult = {
  summary: string;
  externalApiUsed: false;
};
