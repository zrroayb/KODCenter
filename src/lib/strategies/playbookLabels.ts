// Playbook etiketleri — tek kaynak. Hem UI kartları hem Telegram mesajı buradan okur, böylece
// "aynı sinyali farklı isimle gösterme" kuralı korunur.
// Ağır bağımlılık yok; hem tarayıcı bileşenleri hem cloud-scan güvenle import edebilir.

export const PLAYBOOK_LABELS: Record<string, string> = {
  crt: "CRT Reversal"
};

export const PLAYBOOK_SHORT_LABELS: Record<string, string> = {
  crt: "Reversal"
};

export function playbookLabel(strategyId: string): string {
  return PLAYBOOK_LABELS[strategyId] ?? strategyId;
}

export function playbookShortLabel(strategyId: string): string {
  return PLAYBOOK_SHORT_LABELS[strategyId] ?? strategyId;
}
