import { useState } from "react";
import type { MarketSymbol } from "../lib/ict/types";
import type { RuntimeMarketMemory } from "../lib/memory/marketMemory";
import type { StrategyModule } from "../lib/strategies/types";
import { MIN_VISIBLE_SIGNAL_SCORE } from "../lib/userRules/scorePolicy";
import type { UserRules } from "../lib/userRules/userRules";

type TelegramTestState = { state: "idle" | "loading" | "ok" | "warn" | "err"; msg: string };

// Telegram bağlantısını READY sinyal beklemeden test eder: sunucuya "context" türü bir
// test payload'u POST eder (bu tür Gemini yorumunu atlar). Sonuç, token'lar Render'da
// dolu mu / bot doğru mu anında gösterir.
async function runTelegramTest(): Promise<TelegramTestState> {
  try {
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alertKind: "context",
        symbol: "TEST",
        direction: "long",
        rangeTf: "4h",
        confirmTf: "15m",
        rangeLow: 0,
        rangeHigh: 0,
        reasons: [
          "🧪 Bu bir TEST bildirimidir.",
          "Telegram bağlantısı (BOT_TOKEN + CHAT_ID) çalışıyor.",
          new Date().toLocaleString("tr-TR")
        ]
      })
    });
    const result = await response.json().catch(() => ({})) as { status?: string; reason?: string; error?: string };
    if (response.ok && result.status === "sent") {
      return { state: "ok", msg: "✅ Test mesajı gönderildi — Telegram'ı kontrol et." };
    }
    if (result.status === "disabled") {
      return { state: "warn", msg: "⚠️ Token yok. Render → kod-center → Environment'ta TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID'yi doldur." };
    }
    return { state: "err", msg: `❌ Telegram hata verdi: ${(result.error ?? "bilinmeyen").slice(0, 200)}` };
  } catch (error) {
    return { state: "err", msg: `❌ İstek başarısız: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"];
const KILLZONES = ["Asia", "London", "New York AM", "London Close", "Outside"];

export function SettingsView({
  strategies,
  rules,
  memory,
  onRulesChange
}: {
  strategies: StrategyModule[];
  rules: UserRules;
  memory: RuntimeMarketMemory;
  onRulesChange: (rules: UserRules) => void;
}) {
  const [telegramTest, setTelegramTest] = useState<TelegramTestState>({ state: "idle", msg: "" });
  const sendTelegramTest = async () => {
    setTelegramTest({ state: "loading", msg: "Gönderiliyor…" });
    setTelegramTest(await runTelegramTest());
  };
  const updateNumber = (key: "minimumRR" | "minimumScore" | "maxSignalsPerScan" | "moveToBreakevenAtR", value: number) => {
    const next = Number.isFinite(value) ? value : 0;
    const normalized = key === "minimumScore" ? Math.min(100, Math.max(MIN_VISIBLE_SIGNAL_SCORE, next)) : next;
    onRulesChange({ ...rules, [key]: normalized });
  };
  const toggleSymbol = (symbol: MarketSymbol) => {
    const next = rules.allowedSymbols.includes(symbol)
      ? rules.allowedSymbols.filter((item) => item !== symbol)
      : [...rules.allowedSymbols, symbol];
    onRulesChange({ ...rules, allowedSymbols: next.length ? next : rules.allowedSymbols });
  };
  const toggleKillzone = (killzone: string) => {
    const next = rules.allowedKillzones.includes(killzone)
      ? rules.allowedKillzones.filter((item) => item !== killzone)
      : [...rules.allowedKillzones, killzone];
    onRulesChange({ ...rules, allowedKillzones: next.length ? next : rules.allowedKillzones });
  };
  return (
    <section className="settings-grid">
      <article className="panel">
        <header className="panel-head"><h2>Strateji</h2><span className="badge">{strategies.length}</span></header>
        <div className="list-stack">
          {strategies.map((strategy) => (
            <div className="row-item" key={strategy.id}>
              <strong>{strategy.name}</strong>
              <span>{strategy.description}</span>
              <b>{strategy.requiredTimeframes.join(", ")}</b>
            </div>
          ))}
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Kurallar</h2><span className="badge">lokal</span></header>
        <div className="form-grid">
          <label>Stop profili
            <select value={rules.stopProfile} onChange={(event) => onRulesChange({ ...rules, stopProfile: event.target.value as UserRules["stopProfile"] })}>
              <option value="aggressive">Agresif</option>
              <option value="normal">Normal</option>
              <option value="conservative">Muhafazakar</option>
            </select>
          </label>
          <label>Slippage stress
            <select value={rules.slippageStress} onChange={(event) => onRulesChange({ ...rules, slippageStress: event.target.value as UserRules["slippageStress"] })}>
              <option value="normal">Normal</option>
              <option value="high">Yüksek volatilite</option>
            </select>
          </label>
          <label>Minimum RR<input type="number" step="0.1" value={rules.minimumRR} onChange={(event) => updateNumber("minimumRR", Number(event.target.value))} /></label>
          <label>Minimum kalite (olasılık değil)<input type="number" min={MIN_VISIBLE_SIGNAL_SCORE} max="100" value={rules.minimumScore} onChange={(event) => updateNumber("minimumScore", Number(event.target.value))} /></label>
          <label>Max sinyal<input type="number" min="1" value={rules.maxSignalsPerScan} onChange={(event) => updateNumber("maxSignalsPerScan", Number(event.target.value))} /></label>
          <label>BE tetikleyici R<input type="number" step="0.25" min="0" value={rules.moveToBreakevenAtR} onChange={(event) => updateNumber("moveToBreakevenAtR", Number(event.target.value))} /></label>
        </div>
        <div className="toggle-grid">
          <label><input type="checkbox" checked={rules.partialTpEnabled} onChange={(event) => onRulesChange({ ...rules, partialTpEnabled: event.target.checked })} /> EQ'da kısmi kâr</label>
          <label><input type="checkbox" checked={rules.useExecutionCosts} onChange={(event) => onRulesChange({ ...rules, useExecutionCosts: event.target.checked })} /> Spread / slippage dahil</label>
          <label><input type="checkbox" checked={rules.avoidNews} onChange={(event) => onRulesChange({ ...rules, avoidNews: event.target.checked })} /> Haber saatinde no trade</label>
          <label><input type="checkbox" checked={rules.usePremiumDiscountFilter} onChange={(event) => onRulesChange({ ...rules, usePremiumDiscountFilter: event.target.checked })} /> Premium / Discount</label>
          <label><input type="checkbox" checked={rules.useJudasSwingFilter} onChange={(event) => onRulesChange({ ...rules, useJudasSwingFilter: event.target.checked })} /> Judas Swing</label>
          <label><input type="checkbox" checked={rules.useHtfAlignmentFilter} onChange={(event) => onRulesChange({ ...rules, useHtfAlignmentFilter: event.target.checked })} /> HTF alignment</label>
        </div>
        <div className="selector-block">
          <strong>Taranacak symbol</strong>
          <div className="toggle-grid compact">
            {SYMBOLS.map((symbol) => <label key={symbol}><input type="checkbox" checked={rules.allowedSymbols.includes(symbol)} onChange={() => toggleSymbol(symbol)} /> {symbol}</label>)}
          </div>
        </div>
        <div className="selector-block">
          <strong>Killzone</strong>
          <div className="toggle-grid compact">
            {KILLZONES.map((killzone) => <label key={killzone}><input type="checkbox" checked={rules.allowedKillzones.includes(killzone)} onChange={() => toggleKillzone(killzone)} /> {killzone}</label>)}
          </div>
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Telegram</h2><span className="badge">bildirim</span></header>
        <p className="settings-note">
          Bildirimler yalnızca site açıkken ve bir sinyal READY olduğunda gönderilir; token'lar Render
          ortam değişkenlerinde tutulur. Aşağıdaki buton, READY beklemeden bağlantıyı test eder.
        </p>
        <button type="button" className="ghost-btn" onClick={sendTelegramTest} disabled={telegramTest.state === "loading"}>
          {telegramTest.state === "loading" ? "Gönderiliyor…" : "Test bildirimi gönder"}
        </button>
        {telegramTest.state !== "idle" && telegramTest.state !== "loading" && (
          <p className={`telegram-test-result ${telegramTest.state}`}>{telegramTest.msg}</p>
        )}
      </article>
      <article className="panel wide">
        <header className="panel-head"><h2>Oturum hafızası</h2><span className="badge">yenilemede sıfırlanır</span></header>
        <p>Aktif symbol {memory.activeSymbol} · son bias {memory.latestBias} · önceki bias {memory.previousBias ?? "yok"} · son sinyal {memory.recentSignals.length} · elenen {memory.rejectedSetups.length} · scan {memory.scanHistory.length}</p>
      </article>
    </section>
  );
}
