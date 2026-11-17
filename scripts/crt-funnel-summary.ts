// Aggregates the per-run summaries written by crt-funnel.ts --summary (one JSON per variant ×
// shift) into a table and applies the pre-registered ChoCH decision rule (crtFunnelGates.ts).
// Usage: npx tsx scripts/crt-funnel-summary.ts <dir with *.summary.json> [--out file.md]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decideChochDefault, variantStats, type FunnelSummary } from "./crtFunnelGates";

const dir = process.argv[2] ?? ".";
const outIndex = process.argv.indexOf("--out");
const rows = readdirSync(dir)
  .filter((name) => name.endsWith(".summary.json"))
  .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as FunnelSummary);
const stats = variantStats(rows).sort((a, b) => a.variant.localeCompare(b.variant));
const decision = decideChochDefault(stats);
const lines = [
  "# ChoCH varyantları — kayma 0..3 özeti",
  "",
  "| Varyant | Koşu | READY ort. (min–max) | Toplam R ort. (min–max) | ChoCH'u geçen ort. |",
  "|---|---|---|---|---|",
  ...stats.map((item) => `| ${item.variant} | ${item.runs} | ${item.readyMean.toFixed(2)} (${item.readyMin}–${item.readyMax}) | ${item.rMean.toFixed(2)} (${item.rMin.toFixed(2)}–${item.rMax.toFixed(2)}) | ${item.chochMean.toFixed(1)} |`),
  "",
  `**Karar kuralı (önceden yazılı):** ${decision.branch === "none" ? "hiçbir dal" : decision.branch} — ${decision.reason}`,
  "",
  "> Örnek 30'un altındaysa bu bir \"sistemi sinyal üretir halde tutma\" kararıdır, avantaj kanıtı değildir."
];
console.log(lines.join("\n"));
if (outIndex > 0) writeFileSync(process.argv[outIndex + 1], lines.join("\n"));
