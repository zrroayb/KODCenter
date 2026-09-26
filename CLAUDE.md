# KODCenter — Proje Rehberi (Claude için)

Bu dosya, bu depoda çalışan her Claude oturumu için genel yapı, kurallar ve
konvansiyonları özetler. Kod yazmadan önce oku.

## 1. Bu proje nedir (ALTIN KURAL)

KODCenter, **CRT / ICT** (Candle Range Theory / Inner Circle Trader) mantığıyla
piyasa **takip ve karar-destek** aracı olan bir web uygulamasıdır.

> **Bu bir trade bot DEĞİLDİR.** Otomatik emir açmaz/kapatmaz. Sadece kullanıcıya
> setup'ları gösterir, analiz eder, yönlendirir. Yeni özellik eklerken bu sınırı koru:
> "sinyal üret + açıkla + izle", "otomatik al/sat" değil.

Kullanıcı mottosu: **"simple is the best."** Aşırı-mühendislikten kaçın. Yeni bir
katman/soyutlama eklemeden önce mevcut olanı sadeleştirmeyi düşün. Şüphedeyken sor.

## 2. Teknoloji

- **React + TypeScript + Vite** (SPA). Grafikler: `lightweight-charts` (TradingView).
- İkonlar: `lucide-react`. Ekstra ağır bağımlılık yok — sade tut.
- `vite preview` hem SPA'yı **hem de** `/api/gemini/*` ve Telegram endpoint'lerini
  serve eder (middleware `vite.config.ts` içindeki `configurePreviewServer`/
  `configureServer`). **Ayrı bir Node server dosyası yoktur.**
- İkincil hedef: Cloudflare Worker (`worker/index.ts`, `wrangler.jsonc`, D1
  `tradebot-state`). Canlı site DEĞİL — aşağıya bak.

## 3. Komutlar

```bash
npm run dev      # geliştirme (vite, 127.0.0.1)
npm test         # vitest run — PUSH ETMEDEN ÖNCE HER ZAMAN ÇALIŞTIR
npm run build    # tsc -b + worker typecheck + vite build
npm start        # prod önizleme (Render bunu kullanır)
npx tsc --noEmit # hızlı tip kontrolü
```

**Kalite kapısı:** Push'tan önce `npx tsc --noEmit` **ve** `npm test` yeşil olmalı
(şu an 252 test). Grafik/AI değişikliklerinde bunları atlama.

## 4. Deploy — ÖNEMLİ

- **Canlı site = Render** (`render.yaml`, servis adı `kod-center`,
  `startCommand: npm start`, `autoDeploy: true`). Render **`main` branch'inden**
  otomatik deploy eder. Render GitHub secret'larını OKUMAZ.
- **Cloudflare Worker ayrı ve canlı site değildir** (`.github/workflows/cloudflare-deploy.yml`).
  Karıştırma; kullanıcı bir kez bununla vakit kaybetti.
- **Gemini AI ortam değişkenleri (Render Dashboard → kod-center → Environment):**
  - `GEMINI_API_KEY` — `render.yaml`'da `sync: false`, yani panelden elle girilir.
    **API anahtarını ASLA repoya/koda commit etme.** Sadece platform env'inde durur.
  - `GEMINI_MODEL` — varsayılan `gemini-3.8-flash`. Google model kapatırsa
    (API `404 NOT_FOUND`) panelden güncel model adını yaz; kod env'den okuduğu için
    yeni deploy gerekmez.
- Sağ üstteki **build saati** (`__BUILD_TIME__`, `vite.config.ts` `define`) hangi
  deploy'un canlı olduğunu gösterir — staleness kontrolü için.

## 5. Dizin haritası (önemli olanlar)

```
src/
  components/        UI (React). ChartsView, SignalDetailsPanel, CrtLiteChart, Sidebar, App...
  lib/
    ict/             Çekirdek tipler (types.ts), semboller, format.
    strategies/crt/  CRT motoru (crt.strategy.ts) — sistemin kalbi.
    intelligence/    marketContext, structuralBias, smtEngine, structureEngine...
    gemini/          Gemini istemci modülleri + prompt/şema kontratları (crtInterpretation.ts, tradeCommentary.ts, crtKnowledge.ts).
    backtest/        runtimeReplay (geçmiş veriyle replay/doğrulama).
    rules/, risk/, session/, journal/ ...
  data/              demoData (fixture pariteleri).
  test/              vitest (*.test.ts).
worker/index.ts      Cloudflare Worker + kendi Gemini/prompt kopyaları.
vite.config.ts       CANLI sunucu mantığı: /api/gemini/* handler'ları + sistem talimatları burada.
knowledge/           CRT kuralları, prompt referansları (insan-okunur).
docs/                CRT_CHANGELOG, CLOUDFLARE_DEPLOY...
```

## 6. CRT motoru — kavramlar

`src/lib/strategies/crt/crt.strategy.ts` çekirdektir. Ayrımı koru:

- **Gates (blockers)** = hard engeller; biri varsa setup READY olamaz.
- **Quality (warnings + score)** = yumuşak; skoru ve grade'i etkiler ama tek başına
  veto etmez. Skor yalnızca **grade** belirler; `readyEligible`'da skor eşiği YOKTUR.
- **`readyEligible`**: `entryStatus==="confirmed"` + `rr>=minimumRR` +
  `managementRR>=1` + `blockers.length===0` + PD hizası + manipulation +
  gerçek hedef + geçerli stop + model hazır + `dataConfidence>=35`.
- **Anchor aileleri**: gerçek ANCHORS (1W→4H/1D→1H/4H→15m/1H→5m) + deneysel
  (FVG-origin, active-CRT). CRT kuralı: **dip sweep'i otomatik long yapmaz**,
  tepe sweep'i otomatik short yapmaz — HTF draw (DOL) ve context belirler.
- **Tek yön kaynağı = motor** (`context.crt.selectedBias.direction` veya seçili
  `signal.direction`). UI/grafik yardımcıları buna TABİ olmalı, asla ters yön
  göstermemeli (bkz. `CrtLiteChart` — geometrik etiketler motora tabi kılındı).

## 7. Gemini AI katmanı

- İstemci `src/lib/gemini/*` payload'u kurar → `/api/gemini/*`'a POST eder.
- Sunucu (vite.config.ts) deterministik kanıtı yorumlatır; **Gemini olay/mum/seviye
  UYDURAMAZ**, yalnızca verilen `event id`'leri referans alır (`validate*` ile denetlenir).
- Anahtar yoksa lokal fallback döner ("Gemini kapalı — ... lokal analiz").
- **Çıktı dili: TÜRKÇE.** Sistem talimatlarında kural var: serbest-metin alanları
  Türkçe; **CRT/ICT terimleri İngilizce kalır** (CRT, sweep, liquidity, displacement,
  FVG, order block, premium/discount, MSS, CISD, HTF/LTF, killzone, DOL, POI).
  Yeni prompt eklersen aynı kuralı ekle. Bu talimatlar 3 yerde tekrarlanır:
  `vite.config.ts` (canlı), `worker/index.ts`, `src/lib/gemini/crtInterpretation.ts`
  — birini değiştirirsen diğerlerini de senkron tut.

## 8. UI konvansiyonları

- Arayüz dili **Türkçe**; teknik terimler İngilizce kalır (yukarıdaki gibi).
- Kullanıcıya gösterilen sayılar okunur olsun: güven `0.8` değil **`%80`**.
- `dataviz` skill paleti: bull `#089981`, bear `#f23645`, accent `#3987e5`,
  arka plan `#0f131c`. Grafik renklerinde bunları kullan.
- Telefon genişliğinde çalışmalı (responsive).

## 9. Git akışı

- Geliştirme branch'i: `claude/eur-usd-trading-hpxmxn`.
- `main`'e **PR ile** merge et (önceki akış: PR aç → merge). Merge → Render deploy.
- API anahtarı / secret'ı asla commit etme. Commit mesajlarında model adı yazma.
- Push: `git push -u origin <branch>`, network hatasında exponential backoff ile retry.
