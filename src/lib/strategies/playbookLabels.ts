// Playbook etiketleri — tek kaynak. Hem UI kartları hem Telegram mesajı buradan okur, böylece
// "aynı sinyali farklı isimle gösterme" kuralı korunur ve reversal/continuation ayrımı nettir.
// Ağır bağımlılık yok; hem tarayıcı bileşenleri hem worker güvenle import edebilir.

export const PLAYBOOK_LABELS: Record<string, string> = {
  crt: "CRT Reversal",
  "trend-continuation": "Trend Continuation"
};

export const PLAYBOOK_SHORT_LABELS: Record<string, string> = {
  crt: "Reversal",
  "trend-continuation": "Continuation"
};

export function playbookLabel(strategyId: string): string {
  return PLAYBOOK_LABELS[strategyId] ?? strategyId;
}

export function playbookShortLabel(strategyId: string): string {
  return PLAYBOOK_SHORT_LABELS[strategyId] ?? strategyId;
}
