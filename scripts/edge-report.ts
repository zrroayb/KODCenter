// Haftalık (varsayılan 7 gün) live-forward edge raporu. Worker'ın /api/edge-report ucundan
// çözülmüş READY sonuçlarını playbook bazında okur ve tablo basar. Salt-okunur, public uç.
// Kullanım: npm run report:edge   (opsiyonel: EDGE_DAYS=30, CLOUD_SCAN_URL=...)
const baseUrl = (process.env.CLOUD_SCAN_URL ?? "https://kodcenter.deathgateway-ag.workers.dev").replace(/\/+$/, "");
const days = Number(process.env.EDGE_DAYS ?? process.argv[2] ?? "7");

type PlaybookRow = { strategyId: string; trades: number; totalR: number; expectancyR: number; winRatePct: number; profitFactor: number };

const LABELS: Record<string, string> = { crt: "CRT Reversal", "trend-continuation": "Trend Continuation" };

async function run() {
  const res = await fetch(`${baseUrl}/api/edge-report?days=${days}`);
  if (!res.ok) throw new Error(`edge-report HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json() as { status: string; days: number; generatedAt: number; playbooks: PlaybookRow[] };

  console.log(`\nLive-forward edge report · son ${body.days} gün · ${new Date(body.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  console.log("(çözülmüş READY sonuçları; entry sonrası önce stop mu ilk hedef mi görüldü)\n");
  if (!body.playbooks.length) {
    console.log("  Henüz çözülmüş sonuç yok. (Cloud-scan çalışıp READY alertleri ürettikçe ve fiyat");
    console.log("   stop/hedefe ulaştıkça buraya düşer. Bot canlı değilse önce onu ayağa kaldır.)\n");
    return;
  }
  for (const p of body.playbooks.sort((a, b) => b.expectancyR - a.expectancyR)) {
    const verdict = p.trades < 12 ? "yetersiz örneklem" : p.expectancyR <= -0.15 || p.profitFactor < 0.9 ? "AVOID" : p.expectancyR >= 0.15 && p.profitFactor >= 1.15 ? "EDGE" : "nötr";
    console.log(`  ${(LABELS[p.strategyId] ?? p.strategyId).padEnd(20)} trades=${String(p.trades).padStart(3)}  R=${p.totalR.toFixed(2).padStart(7)}  exp=${(p.expectancyR >= 0 ? "+" : "") + p.expectancyR.toFixed(2)}  win=${p.winRatePct.toFixed(1)}%  PF=${p.profitFactor.toFixed(2)}  → ${verdict}`);
  }
  console.log("");
}

run().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
