# CRT Secrets — kaynak kuralları (sahibin referans kaynağı)

Kaynak: "CRT Secrets Türkçe Altyazılı" oynatma listesi (Romeo / Dr. Romeo / thorfinn), NotebookLM
ile çıkarılan özet (2026-10-02). Motor, grafik ve Gemini bilgi tabanı bu kurallara göre
hizalanır. Kaynakla çelişen eski kural varsa **bu dosya kazanır**.

## 1. Range (Candle 1) ve çizim
- CRT 3 mum döngüsüdür: **Candle 1** (accumulation, range), **Candle 2** (manipulation / sweep /
  turtle soup), **Candle 3** (distribution, hedefe genişleme). İstisna: hızlı piyasada 2 mumlu CRT.
- Range High/Low **wick** (uç noktalar) ile ölçülür. Gövde, sweep sonrası kalın mumun tersine
  kapanışını (reclaim/trigger) kontrol için kullanılır.
- **EQ (%50)** çizilir; Target 1'dir.
- Çizgiler Candle 1'in High / EQ / Low'undan başlar, sağa uzatılır.
- Range TF'leri: 1W, 1D, 4H (ileri seviye 1M). HTF range seviyeleri alt TF grafiğine **aynen
  taşınır**; giriş ve iç yapı alt TF'de aranır.

## 2. TF eşleşmesi ve zamanlama
- 1M → 1D · 1W → 4H · 1D → 1H veya 15m.
- Haftalık döngü: Pazartesi sahte high/low; Salı/Çarşamba haftanın gerçek high/low'u (turtle
  soup); Perşembe/Cuma karşı uç hedeflenir.
- 4H "1/5/9 NY açılış" gibi **mekanik saat kalıpları reddedilir**.

## 3. Setup sırası
1. **Sweep:** Candle 2, Candle 1'in High (BSL) veya Low (SSL) dışına **fitille** hızlı atış; range
   dışında kapanış olmamalı.
2. **Reclaim (şart):** sweep yapan kalın mumun tersine **gövde kapanışı**; kapanış gelmeden işlem yok.
3. **Alt TF onayı:** Model #1 (kalın mumun tersine gövde kapanışı) veya **True MSS** (Low → High →
   Lower Low → High'ın yukarı kırılması; short için tersi). FVG ve SMT olasılığı artırır. "Kiss of
   death turtle soup": hedeften önceki son manipülasyon.
4. **Giriş:** A) Model #1 kapanışı; B) True MSS sonrası FVG / OTE (%62–79) / retest bölgesi.
5. **Stop:** turtle soup mumunun uç noktasının hemen ötesi.
6. **Hedef:** T1 = EQ (kâr al ve/veya stop BE); T2 = karşı uç (DOL).

## 4. Geçersizlik ve filtreler
- Range dışında kapanış (acceptance) veya sweep ucunu kırıp o yönde genişleme → geçersiz.
- Hedefe giderken ters SMT + Model #1 / True MSS → hedef iptal.
- EQ'ya ulaşıp karşı uca gidemeyip ters yapı → setup tamamlandı sayılır.
- **HTF trend: ZORUNLU** (trend tersine CRT yasak).
- **Key level: ZORUNLU** (HTF eski high/low, FVG, mum açılış fiyatı).
- Killzone / haber için kodlanabilir mekanik kural kaynakta yok.

## 5. Yaygın hatalar
1. Candle 2'yi işlemek (sadece Candle 3 işlenir).
2. Kapanışı beklemeden fitile girmek.
3. Key level olmadan her mum şablonunu CRT sanmak.
4. HTF trendinin tersine işlem.
5. Aşırı işlem (hyper scalping).

## Uygulama durumu (bu repoda)
| Kural | Durum |
|---|---|
| Grafikte Candle 1 H/EQ/L, 3 mum fazı, HTF→LTF taşıma | ✅ `src/lib/charts/crtRange.ts` |
| Key level zorunlu | ✅ blocker (2026-10-02) |
| HTF trend zorunlu, istisnasız | ✅ blocker (2026-10-02) |
| Sadece Candle 3 (C2 HTF kapanışını bekle) | ✅ C2 range içinde kapanmadan READY yok (blocker, 2026-10-02) |
| 1/5/9 bonusu kaldır | ✅ skor ve referans mum kalitesinden çıkarıldı |
| 1M → 1D anchor | ✅ eklendi (grafik + motor + replay) |
| T1'de kâr al (EQ) | ⏳ Replay çıkış karşılaştırması (30 işlem) karar verecek |
| Model #1 doğrudan giriş | ➖ bilinçli olarak eklenmedi: motor kaynağın Giriş B'sini (True MSS + FVG/OTE retest) kullanıyor; tek giriş yolu sade ve ölçülebilir |
| Gemini bilgi tabanı + talimatlar | ✅ `src/lib/gemini/crtKnowledge.ts`, `systemInstructions.ts`, trade mentoru prompt'u |
