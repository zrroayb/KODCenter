# CRT denetimi — 2026-11-14

Soru: motorun aradığı ve onayladığı şey gerçekten CRT mi, ve bu onay bir avantaj taşıyor mu?

Kapsam: `crt.strategy.ts`, `htfCrt.ts` (main'e henüz merge edilmemiş D/W/M commit'i dahil),
`targetInvalidation.ts`, `outcomeEngine.ts`, `runtimeReplay.ts`, `charts/crtRange.ts`. Motor
davranışı DEĞİŞMEDİ; bu iş yalnız ölçüm, karşı-örnek testi ve rapor.

Kanıt dosyaları:
- Karşı-örnek testleri: `src/test/crtAudit.test.ts` (17 test). Bugünkü davranışı sabitler;
  düzeltme yapılınca ilgili test bilerek ters çevrilir.
- Gerçek zaman aralıklı senaryo (4H mumlar 4 saat, 15m mumlar 15 dk arayla):
  `src/test/crtAuditScenario.ts`.
- Huni scripti: `scripts/crt-funnel.ts` (kapı sınıflandırması `scripts/crtFunnelGates.ts`).

> **Gerçek veri sonucu (2026-11-14, `docs/CRT_HUNI_2026-11-14.md`):** 45.5 gün, 12 sembol, aynı
> mumlarda: eski motor 10 READY (+7.97R), True MSS'li motor 1 READY (−1R). ChoCH'u geçen setup
> 350 → 86. Örnek her iki durumda da karar için yetersiz (< 30). D/W/M kapısının elediği 78 dolmuş
> işlemin beklentisi ≈ 0R.

## Kısa cevap

- **Tespit (range, sweep, C2 kapanışı) büyük ölçüde kaynakla uyumlu.**
- **Onay (ChoCH) ve giriş kaynaktan sapıyor.** Motorun "ChoCH" dediği şey True MSS değil:
  - Sweep'ten sonra oluşan 1 mumluk bir pivotun kırılması.
  - C2'nin içinde de olabiliyor.
  - Taramadan taramaya daha yeni bir pivota kayıyor; bu yüzden aynı setup'ın girişi ve geçmişi sonradan değişiyor.
- **Ölçüm altyapısı canlıyı ölçmüyor.** Replay, girişi zaten dolmuş bir READY için gelecekte ikinci bir dokunuş bekliyor. Bu yüzden "bu onay avantaj taşıyor mu" sorusu bugünkü replay ile cevaplanamaz.
- **Avantaj ölçülmedi.**
  - Bu ortamdan Yahoo'ya erişim yok.
  - Demo veride 3710 setup'ın hiçbiri ChoCH kapısını geçmiyor, yani READY yok.
  - Sayı uydurulmadı.

## Bulgular (önem sırasıyla)

### B1 — Replay canlıyı ölçmüyor: dolmuş girişe ikinci dokunuş bekleniyor

> **DÜZELTİLDİ 2026-11-14:** CRT READY'nin dolumu artık sinyalin kendi retest mumundan alınıyor (`runtimeReplay.ts` `filledBeforeScan`); replay girişe ikinci dokunuş beklemiyor. Arşiv `crt-2026-11-14-replay-fill`. Aşağıdaki metin düzeltme öncesi durumu anlatır.
- **Ne:** Bir CRT READY olduğunda girişi zaten geçmişte dolmuştur (retest mumu kapalı, `entryStatus: "confirmed"`). Replay bu sinyali tarama anında alıyor ve ileri mumlarda girişe **yeniden** dokunulmasını bekliyor (`runtimeReplay.ts:814`, dolum zaman aşımı `:828`).
  - Dolumdan sonra girişe dönmeden doğrudan hedefe giden işlem `not-triggered` sayılıyor ve istatistikten düşüyor.
  - Girişe geri dönen işlem ise ikinci dokunuştan itibaren ölçülüyor, yani daha kötü bir yoldan.
  - Canlı sonuç motoru ise dolum mumundan itibaren ölçüyor (`outcomeEngine.ts:23`, başlangıç `findCrtTrackingStartIndex`).
  - CLAUDE.md'deki "canlı == replay" iddiası giriş tarafında geçerli değil.
- **Kanıt:** `crtAudit.test.ts` › "replay ölçümü canlıdan farklı". Giriş 1.003'te doluyor, fiyat 0.95'e (DOL) iniyor; replay sonucu `not-triggered`.
- **Etkisi:** Hızlı kazananları sistematik olarak düşürüyor (survivorship bias). 30 işlemlik çıkış modeli kararı ve tüm replay beklentisi bu hatayla hesaplanıyor.
- **En basit düzeltme:** CRT READY için replay, dolumu sinyalin kendi retest mumundan alsın (girişi yeniden aramasın) ve sonucu canlı ile aynı fonksiyonla ölçsün (`evaluateCrtForwardOutcomeCore`).
- **Sinyal sayısına etkisi:** Yok; yalnız ölçüm değişir. Arşiv sıfırlanmalı (`REPLAY_ARCHIVE_VERSION`).

### B2 — Fiyat girişe hiç ulaşmadan READY

> **DÜZELTİLDİ 2026-11-14:** retest artık yalnız GİRİŞ seviyesine dokunuşla aranıyor (FVG bölgesi kullanılmıyor, `crt.strategy.ts` retest araması). Testler: `crtAudit.test.ts` › "B2".
- **Ne:** Retest, POI bir FVG ise **bölgeye** dokunuşla aranıyor (`crt.strategy.ts:985-990`). Giriş fiyatı ise `entryLevelForAnchor` (`:744`) ile seçiliyor ve short için FVG alt kenarı ChoCH seviyesinin üstünde değilse **ChoCH seviyesi** oluyor.
  - Fiyat FVG'nin alt kenarına değip dönünce giriş "confirmed" sayılıyor, oysa giriş fiyatı (daha yukarıdaki ChoCH seviyesi) hiç işlem görmedi.
  - Canlı sonuç motoru dolumu görmüyor (`not-triggered`), ama sinyal READY ve Telegram READY alarmı gidiyor.
- **Kanıt:** `crtAudit.test.ts` › "FVG bölgesine dokunuş 'dolum' sayılır ama giriş fiyatı ChoCH seviyesidir". C3'ün en yükseği 0.9995, giriş 1.003, sonuç `not-triggered`.
- **Etkisi:** Kullanıcıya "Plan hazır, giriş doldu" deniyor ama işlem yok. Gerçek dolumun sonradan gelmesi de C3 penceresi dışında kalabiliyor.
- **En basit düzeltme:** Retest, plan girişine dokunuşla aransın (`findCrtEntryRetestIndex`'e zone verilmesin) ya da giriş, dokunulan bölge kenarı olsun. İkisi tek kural.
- **Sinyal sayısına etkisi:** READY biraz azalır (yalnız bu uyumsuzluk durumları).

### B3 — Onay geçmişi yeniden yazılıyor: dolmuş ve kazanan işlem "missed / tüketildi" görünüyor

> **DÜZELTİLDİ 2026-11-14:** ChoCH referansı sweep öncesi swing; sweep mumuna bağlı olduğu için taramalar arasında kaymıyor. Testler: "B3" ve `crtChoch.test.ts` › "no drift".
- **Ne:** `postSweepShiftReference` (`:500`) sweep'ten sonraki, sonradan kapanışla kırılmış **en son** mikro pivotu seçiyor ve bu seçim post-sweep pivota öncelik veriyor (`:561`).
  - Fiyat hedefe giderken her yeni kırılan pivot "ChoCH" oluyor; giriş seviyesi o pivota kayıyor, retest kayboluyor.
  - EQ bu yeni girişten önce görülmüş sayılıyor ve setup "EQ tüketildi, missed" oluyor.
- **Kanıt:** `crtAudit.test.ts` › "geçmiş yeniden yazılıyor" (2 test). Giriş 1.003'te doldu ve DOL görüldü, ama sonraki taramada giriş 0.994 / pending, blocker "tüketildi", sonuç tp2 değil. İkinci test (bağımsız kontrol, 2026-11-14): işlem hâlâ AÇIKKEN (EQ görülmeden, stop olmadan) fiyat yavaşça düşerken üçüncü mumda sinyal READY/open'dan WATCH/pending/not-triggered'a dönüyor, giriş 0.999'a kayıyor.
- **Etkisi:**
  - Açık işlem ekrandan düşüyor; `signalIsOpenTrade` çalışmıyor.
  - Çıkış uyarısı (`targetInvalidation`) açık işlemi göremiyor.
  - Canlı sonuç tp2'yi asla kaydetmiyor.
  - Aynı setup her taramada başka bir setup gibi görünüyor.
- **En basit düzeltme:** ChoCH referansını sabitle. İlk geçerli kırılım bulunduktan sonra seviye değişmesin; referans sweep **öncesi** swing olsun (bkz. B4).
- **Sinyal sayısına etkisi:** Belirsiz; ölçülmedi.

### B4 — "ChoCH" True MSS değil, kendi kendini onaylıyor

> **DÜZELTİLDİ 2026-11-14:** `postSweepShiftReference` silindi; onay yalnız sweep öncesi iç swing'in kapanışla kırılmasıdır (True MSS). Eşikler (gövde ≥ 0.5, range ≥ 0.8 × ortalama, FVG ile terfi) ve sweep→kırılım ≤ 12 mum kuralı aynen duruyor. Sinyal sayısına etkisi gerçek veride ÖLÇÜLMEDİ (demo ChoCH üretmiyor); beklenen: azalır. Testler: "şüphe 3/4".
- **Kaynak:** True MSS = Low → High → Lower Low → **High'ın** kırılması (short için tersi). Yani sweep **öncesindeki** swing kırılmalı.
- **Kod:**
  - Önce sweep **sonrası** 1 mumluk pivot aranıyor (`:559-561`). Bu pivot yalnızca "sonradan kapanışla kırılmışsa" kabul ediliyor (`:524-526`), yani kırılım tanım gereği zaten var.
  - Eşikler: kapanış ortalama range'in %3'ü kadar geçmeli (`:566`); gövde ≥ 0.5 ve range ≥ 0.8 × ortalama (`:597`). Zayıf kırılım bağlı FVG ile terfi ediyor (`:978`).
  - Ters yöndeki her düzeltme bacağı bir mikro pivot bırakıp onu kırdığında "ChoCH" oluşuyor.
- **Kanıt:** `crtAudit.test.ts` › "ChoCH = True MSS mi?". Kırılan seviye 1.003 (sweep sonrası pivot). Sweep öncesi son 15m swing low 0.993; hiçbir kapanış 0.995'in bile altına inmedi, buna rağmen READY.
- **Etkisi:** Onay ayırt edici değil. Asıl filtre işlevini sweep + C2 kapanışı + key level + yön görüyor.
- **En basit düzeltme:** Yalnız sweep öncesi swing (pre-sweep `confirmedSwing` / `internalShiftReference`) referans olsun; post-sweep yolu kaldırılsın.
- **Sinyal sayısına etkisi:** Belirgin azalır. Not: 2026-07-29'da post-sweep yolu "huni 19→0" sorununu açmak için eklenmişti; sahibinin kararı.

### B5 — Sıra: ChoCH C2'nin içinde olabiliyor
- **Kaynak:** C2 kapanır → C3'te alt TF onayı → retest.
- **Kod:** ChoCH araması manipulation mumundan (C2'nin içi) başlıyor (`:568`). Yalnız retest C3 penceresinde aranıyor (`:979-994`). ChoCH zamanı ile C3 penceresi karşılaştırılmıyor.
- **Kanıt:** `crtAudit.test.ts` › "ChoCH Candle 2'nin İÇİNDE oluşmuşken READY". ChoCH C3 açılışından 135 dk önce; karşılaştırma testinde C3 içindeki ChoCH ile de READY.
- **Etkisi:** Kaynaktan sapma. Power of 3 açısından (C2 kapanışı + CSD birlikte) savunulabilir de olabilir.
- **En basit düzeltme:** ChoCH kırılım mumu C3 penceresinde olsun (`inCandle3(...) !== "before"`). Ya da sahibi "C2 içinde CSD de olur" derse kaynak notuna yazılsın.
- **Sinyal sayısına etkisi:** Azalır; ölçülmedi.

### B6 — Üç ayrı CRT tanımı

> **KISMEN DÜZELTİLDİ 2026-11-14:** grafik ve D/W/M okuması tek fonksiyonda (`readCrtCycle`). Motorun C1 seçimi (6 mum geriye, bitişik olmayan C2) sahibinin kararıyla değişmedi; bitişiklik şartı gerçek veri ölçümüne bağlı.
- **Ne:** Aynı mumlarda üç fonksiyon üç farklı C1/C2 tanımı kullanıyor:
  - **Motor** (`detectAnchorRaid`, `:281`): C1, 6 mum geriye kadar herhangi bir mum olabilir (`RAID_PERSISTENCE_LOOKBACK`, `:42`). C2 = C1'i süpüren **ilk** sonraki mum; bitişik olması gerekmiyor.
  - **D/W/M yön** (`readHtfCrt`, `htfCrt.ts:34`): yalnız son iki kapanmış mum.
  - **Grafik** (`activeCrtRange`, `crtRange.ts:25`): yalnız son iki kapanmış mum.
- **Kanıt:** `crtAudit.test.ts` › "üç ayrı CRT tanımı". İç mum varken motor C1 = 101/95 (EQ 98) seçiyor, grafik ve D/W/M okuması C1 = 100/97 (EQ 98.5).
- **Etkisi:** Grafikteki range, motorun işlem yaptığı range'den farklı olabiliyor. Sinyal seçiliyse `signalCrtRange` bunu düzeltiyor, seçili değilse düzeltmiyor. Kaynak "ardışık 3 mum" diyor.
- **Düzeltme:** Aşağıdaki "Tek CRT tanımı" bölümünde.
- **Sinyal sayısına etkisi:** Bitişiklik şart olursa azalır; ölçülmedi.

### B7 — D/W/M yön kapısı tükenmiş veya bozulmuş üst CRT'yi de geçerli sayıyor

> **KISMEN DÜZELTİLDİ 2026-11-14:** oluşan C3 hedefi almış ya da C2 ucunu aşmışsa üst CRT artık yön vermiyor (`readHtfCrt` `spent`). Açık kalan: 1W setup'ın yönü hâlâ yalnız aylık CRT'den (sahibinin kararı: değiştirme) ve key level toleransı onay TF'sinin ATR'sine bağlı.
- **Ne:** `readHtfCrt` oluşan C3'e hiç bakmıyor:
  - Üst CRT'nin C3'ü hedefi (C1'in karşı ucunu) çoktan almış olsa da yön geçerli.
  - C2'nin ucunu aşmış (geçersiz) olsa da yön geçerli.
- **Ek sorunlar:**
  - 1W setup'ın yönü yalnız aylık CRT'den geliyor (`higherCrtTimeframes`); aylık CRT her ay aktif değil.
  - Key level toleransı = 3 × stop buffer (`:1058`). Buffer onay TF'sinin ATR'sine bağlı (`symbolBuffer`, `:349`), bu yüzden tolerans 15m ATR'den 1D ATR'ye kadar değişiyor; kaynakta karşılığı yok.
- **Kanıt:** `crtAudit.test.ts` › "şüphe 6" (3 test).
- **En basit düzeltme:** Oluşan C3 karşı ucu ya da C2 ucunu geçtiyse o zaman diliminin yönü "yok" sayılsın. Key level toleransı range TF'sine göre sabitlensin (ör. range ATR'sinin oranı).
- **Sinyal sayısına etkisi:** Azalır; ölçülmedi.

### B8 — C2 range dışında kapanınca setup yaşıyor (kısmen doğrulandı)

> **DÜZELTİLDİ 2026-11-14:** kapanmış C2 range dışında kapandıysa o C1'den raid yok (`detectAnchorRaid`); sonra içeri dönüş bunu değiştirmez. Oluşan C2 yolu ve "Candle 2 henüz kapanmadı" mesajı yalnız gerçekten oluşan C2 için.
- **Ne:** C2 range dışında kapanıp sonraki mum içeri dönerse `raidStillActive` (`:248`) raid'i canlı tutuyor (`closed: false`).
  - READY **olamıyor** (C2 kapanış blocker'ı).
  - Ama ekranda "Candle 2 henüz range içinde kapanmadı" (`:1096`) yazıyor; aslında dışarıda kapandı ve kaynağa göre CRT geçersiz.
- **Kanıt:** `crtAudit.test.ts` › "şüphe 2".
- **Etkisi:** Yanlış READY yok; WATCH listesinde gürültü ve yanıltıcı metin var.
- **En basit düzeltme:** Kapanmış C2 dışarıda kapandıysa raid yok (setup gösterilmesin ya da "geçersiz" olsun).
- **Sinyal sayısına etkisi:** READY etkilenmez; WATCH azalır.

### B9 — Skor/grade dar bantta (kısmen doğrulandı)
- **Ne:** READY olabilen en zayıf setup 75 (B), en güçlüsü 100 (A+). Bugünkü kurallarla READY'de D/C görülemez.
- **Ek sorun:** Yorumdaki "kalite 38 puan" eski. Killzone ve session kalemleri silindi; gerçek kalite payı en fazla 31 (`:919` yorumu).
- **Kanıt:** `crtAudit.test.ts` › "şüphe 8".
- **Etkisi:** Grade boyutlandırmada kullanılıyor ama sonuçla ilişkisi ölçülmedi.
- **Düzeltme:** Önce ölç (huni scripti READY'leri grade'e göre kırabilir), sonra karar ver. Yorum düzeltilmeli.

### B10 — Hedef yedeği (çürütüldü)

> **TEMİZLENDİ 2026-11-14:** yedek silindi; READY hedefi değişmedi (audit testleri).
- **Ne:** `targetDol` (`:725`) karşı uç girişin gerisindeyse `bias.drawLevel`'a düşüyor. Ama ChoCH varken giriş her zaman range içinde: POI kenarı `insideRange` ile, ChoCH seviyesi iç pivot filtresiyle sınırlı.
  - READY'de hedef her zaman C1'in karşı ucu.
  - Yedek yalnız ChoCH'suz WATCH planının gösterilen hedefini ve "gerçek hedef yok" blocker'ını etkiliyor.
- **Kanıt:** `crtAudit.test.ts` › "şüphe 7".
- **Düzeltme:** Temizlik; yedek silinebilir. Davranış değişmez.

### B11 — Yöntem: motor kendi kural metnine göre test ediliyor
- Testler motorun kendi kural tanımını sınıyor. Sahibinin grafikte "bu CRT / bu değil" diye işaretlediği örnek yok.
- Replay arşivi 6 hafta içinde 4 kez sıfırlandı (`crt-2026-10-02` → `-10-03-c3only` → `-10-10-audit` → `-11-14-dwm-crt`). 30 işlem kapısı hiç dolmadı. Üstelik B1 yüzünden dolsa da yanlış ölçerdi.
- Demo veri CRT üretmiyor: 3710 setup → 0 ChoCH (huni scripti). Demoyla avantaj ölçülemez.

### Küçük notlar
- **Yanlış kanıt metni:** Kanıt satırı "Kapalı ChoCH mumundan … entry aktif; retest şart değil" diyor (`:1451`). Kural tersini söylüyor (retest zorunlu).
- **Replay sinyal kaybı:** Replay her tarama ve sembol için yalnız ilk sinyale bakıyor (`runtimeReplay.ts:1652`). Aynı anda iki anchor READY olursa biri ölçülmüyor.
- **Retest kontrolü (doğrulanmadı):** `retestFar` (1.5R) kod okumasına göre açık işlemde de READY'yi düşürebilir; testle gösterilmedi.

## Kaynak ↔ kod eşleme tablosu

Satır numaraları `src/lib/strategies/crt/crt.strategy.ts`'tedir, aksi belirtilmedikçe.

| Kaynak kuralı | Kodda nerede / nasıl | Eşik | Durum |
|---|---|---|---|
| CRT = 3 mum (C1 range, C2 sweep, C3 işlem) | `detectAnchorRaid` :281, `candle3Window` :703 | C1 6 mum geriye kadar (:42), C2 = ilk süpüren mum | ⚠️ bitişiklik yok (B6) |
| Range wick ile, EQ %50 | `rangeFromCandle` :220 | — | ✅ |
| C2 fitille dışarı, range içinde kapanır | `raidFromPair` :224, blocker :1096 | kapanış < high (short) | ⚠️ dışarıda kapanış "geçersiz" değil, "bekleniyor" (B8) |
| Reclaim: kalın mumun tersine gövde kapanışı | `manipulationForAnchor` :423 | onay TF'sinde herhangi bir kapanış edge içinde | ⚠️ gövde/kalın mum şartı yok; HTF C2 kapanışı ayrıca şart |
| Alt TF onayı: True MSS | `detectCrtChoch` :531 | post-sweep 1 mumluk pivot öncelikli; gövde ≥ 0.5, range ≥ 0.8 × ortalama | ❌ True MSS değil (B4) |
| Alt TF onayı: Model #1 | — | — | ➖ bilinçli olarak yok |
| Onay C3'te | — | ChoCH zamanı kontrol edilmiyor | ❌ (B5) |
| Giriş B: FVG / OTE / retest | `poiForAnchor` :637, `entryLevelForAnchor` :744, retest :985 | FVG kenarı veya ChoCH seviyesi; bölgeye dokunuş = dolum | ⚠️ OTE yok; dokunulan bölge ≠ giriş fiyatı (B2) |
| Sadece Candle 3 | `candle3Window` :703, :992, :997 | retest C3 penceresinde; C3 biterse missed | ✅ (retest için) |
| Stop: turtle soup ucunun ötesi | :804 | uç + buffer; risk tabanı 1 × ATR (:814) | ✅ (+ kodda fazladan risk tabanı) |
| T1 = EQ, T2 = karşı uç | :830, `targetDol` :725 | EQ'da BE, tamamı DOL | ✅ (yedek READY'de erişilemez, B10) |
| Range dışında kapanış → geçersiz | `raidStillActive` :248 | — | ⚠️ (B8) |
| Ters SMT + ters MSS → hedef iptal | `targetInvalidation.ts:15` | yalnız uyarı | ✅ (uyarı) |
| EQ'ya gelip karşı uca gidemeden ters yapı → tamamlandı | `isCrtEqConsumed` :398 | yalnız girişten önceki EQ | ⚠️ girişten sonra ayrı kural yok; BE sonucu pratikte aynı |
| HTF yönü zorunlu | `evaluateCrtHtfAlignment` :142, `htfCrt.ts:34` | üst D/W/M'den ≥1 aynı yön, 0 ters | ⚠️ oluşan C3'e bakmıyor (B7) |
| Key level zorunlu | :1059, `crtKeyLevels` `htfCrt.ts:65` | 3 × buffer toleransı | ⚠️ tolerans onay TF'sine bağlı (B7) |
| TF eşleşmesi 1M→1D, 1W→4H, 1D→1H, 4H→15m | `ANCHORS` :52 | — | ✅ |
| Haftalık döngü (Pzt sahte uç, Salı/Çarş gerçek uç) | — | — | ➖ yalnız Gemini bilgisinde |
| 1/5/9 mekanik saat yok | skor | — | ✅ |
| Power of 3: C3'te geç giriş | `lateCandle3Entry` :1000 | > %50 | ✅ (uyarı) |

**Kodda olup kaynakta olmayan:**
- CRT range PD zorunluluğu (:1011).
- DOL net RR ≥ 1.0.
- `retestFar` 1.5R (:1017).
- Risk tabanı 1 × ATR / 0.8 × ortalama range.
- Kabul görmüş karşı-trend bastırma (`continuationAcceptanceSuppresses`, :1462; günlük `biasDetail`'den).
- Veri güveni ≥ 35, bayat veri.
- Anchor çatışması (chop) uyarısı.
- Dolum zaman aşımı (16 onay mumu).
- Skor kalemleri: SMT, displacement, referans mum, range respect, valid pullback.

**Kaynakta olup kodda olmayan:**
- True MSS.
- Model #1 girişi.
- OTE (%62–79).
- Haftalık döngü.
- C2 dışarıda kapanınca geçersizlik.
- "C3'te onay" sırası.

## Huni ölçümü

```bash
npm run report:funnel -- --demo                                  # sentetik
npm run report:funnel -- --yahoo --save markets.json --out funnel.md --json funnel.json   # canlı veri (ağ gerekir)
npm run report:funnel -- --input markets.json --days 60
```

Script replay'in kullandığı zaman dilimleriyle (`timeframesAt`) her taramada **tüm** anchor sinyallerini okuyor. Ürettikleri:
- Benzersiz setup başına ulaşılan en derin kapı ve takıldığı kapı; anchor bazında READY sayısı.
- Her READY için iki sonuç: dolumdan itibaren canlı kural ve replay yöntemi (B1'in ölçeği).
- READY kırılımları:
  - ChoCH C2 mi C3 mü,
  - C1-C2 bitişik mi,
  - ChoCH güçlü mü yoksa FVG ile terfi mi etti,
  - giriş fiyatı gerçekten işlem gördü mü (B2),
  - dolum mumunun tepkisi,
  - D/W/M tam mı kısmi mi.
- "Kapı kapalı olsaydı": girişi dolmuş ama yalnız D/W/M ve/veya key level'a takılan setup'ların aynı kuralla sonucu.

**Demo sonucu (30 gün, 12 sembol, 721 tarama):**

| Kapı | Benzersiz setup |
|---|---|
| Tüm setup'lar | 3710 |
| HTF raid | 2000 |
| C2 içeride kapandı | 592 |
| Reclaim | 575 |
| **ChoCH** | **0** |
| READY | 0 |

Demo veri ChoCH üretmiyor; bu bir **veri** sonucu, motorun bulgusu değil. Avantaj sorusu (D maddesi) **ölçülmedi**.

**Gerçek veriyle çalıştırmak için öneri (workflow eklenmedi):**
- Mevcut `background-scan.yml` ile aynı ortamda elle tetiklenen bir iş (`workflow_dispatch`): `npm ci && npm run report:funnel -- --yahoo --days 55 --out funnel.md --json funnel.json`, çıktılar `actions/upload-artifact` ile.
- Yahoo 15m geçmişi ~60 gün; READY < 30 ise script bunu "karar için yeterli değil" diye yazıyor.
- B1 düzeltilmeden de script güvenilir: "dolumdan itibaren" sonucunu replay'den bağımsız hesaplıyor.

## Tek CRT tanımı önerisi

Yeni katman değil; mevcut `htfCrt.ts`'teki `readHtfCrt` tek tanım olsun.

1. **Tanımı genişlet:** `readHtfCrt(candles, at?)` "son iki kapanmış mum" yerine verilen indekste C1 = i−1, C2 = i (bitişik) okur. Oluşan C3'ün C2 ucunu veya hedefi aşıp aşmadığını da döndürür (B7).
2. **Grafik:** `activeCrtRange` = `readHtfCrt` + çizim alanları; ayrı mantık silinir.
3. **Motor:** `detectAnchorRaid` aynı fonksiyonla son 1-2 C2 adayını sınar. Böylece motor, grafik ve D/W/M aynı C1/C2'yi görür; `RAID_PERSISTENCE_LOOKBACK` ve `raidStillActive` sadeleşir (C3 tek mum olduğu için C2 tek mum geriye bakmak yeter).
4. **Testler:** `crtRange.test.ts`, `crtRaidPersistence.test.ts` ve `crtAudit` şüphe 1 tek tanıma göre güncellenir.

Bitişiklik şartı sinyal sayısını azaltır; önce huni scriptindeki "C1-C2 bitişik değil" READY'lerinin sonucu gerçek veriyle görülmeli.

## Sahibinin karar vermesi gereken sorular

1. **Replay düzeltmesi (B1):** READY'nin dolumu kendi retest mumundan alınsın ve canlı ile aynı sonuç fonksiyonu kullanılsın mı? Sinyal sayısını değiştirmez; arşiv sıfırlanır. *Öneri: evet, ilk iş.*
2. **Giriş fiyatı (B2):** Dolum yalnız giriş fiyatına dokunuşla mı sayılsın, yoksa giriş dokunulan FVG kenarı mı olsun?
3. **ChoCH tanımı (B3+B4):** Yalnız sweep öncesi swing'in kırılması (True MSS) mı geçerli olsun? Sinyal belirgin azalır. Ayrıca ilk geçerli kırılım sabitlensin mi (geçmişin yeniden yazılmasını durdurur)?
4. **Sıra (B5):** ChoCH C3 içinde mi olmalı, yoksa C2 içindeki CSD de kabul mü?
5. **Bitişiklik (B6):** C1-C2 bitişik olmalı mı? Grafik ile motor tek tanımda birleşsin mi?
6. **Üst CRT (B7):** Hedefi almış veya ucu aşılmış D/W/M CRT yön vermesin mi? 1W setup için haftalık da yön kaynağı sayılsın mı?
7. **C2 dışarıda kapanış (B8):** Setup tamamen gizlensin mi, "geçersiz" olarak mı görünsün?
8. **Gerçek veri ölçümü:** Huni scripti için `workflow_dispatch` ile çalışan bir GitHub Actions işi eklensin mi (ağ + Yahoo)?
9. **Elle etiket:** 20-30 gerçek grafik örneğini "CRT / değil" diye işaretleyip test fikstürü yapalım mı? Motorun kaynağa uyumunu kendi kural metnimizden bağımsız sınamanın tek yolu bu.
10. **Merge sırası:** D/W/M yön commit'i (`f028cd7`) bu kararlardan önce mi merge edilsin, sonra mı? B7 o commit'in kendi açığı.
