import type { UserRules } from "./userRules";

// Tarayıcı kuralların sahibidir; D1 yalnızca bulut botu için bir aynadır (tek yön).
// Ayar ekranındaki her değişiklik debounce ile /api/rules'a itilir; vite dev'de endpoint
// yoktur ve sessizce düşer — kural senkronu hiçbir zaman UI akışını bloklayamaz.
let timer: ReturnType<typeof setTimeout> | undefined;

export function queueCloudRulesSync(rules: UserRules) {
  if (typeof fetch !== "function") return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void fetch("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rules)
    }).catch(() => undefined);
  }, 1_000);
}
