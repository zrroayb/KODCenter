# DURUM — otonom iş takibi

## Hedef
Denetimde açık kalan 12-14. maddeleri davranışı bozmadan kapatmak. **Bitti** = testler eski KOD
modeli yerine canlı CRT motorunu test ediyor (fikstür silindi), haber takvimi gerçek veriyle
doluyor, sunucu mantığı `vite.config.ts`'ten ayrıldı, typecheck + test + build yeşil, branch'e
pushlandı.

Kurallar: her adımdan önce bu dosya okunur, sonra güncellenir. `main`'e merge = canlı deploy →
yapılmaz, "Bana sorular"a yazılır. Aynı adımda 3 başarısızlık → "takıldı".

## Adımlar
Durum: `[ ]` açık · `[x]` bitti · `[!]` takıldı · `[?]` kararını bekliyor

- [x] 1. CRT test fikstürü: `strategyFixtures.ts`'e gerçek bir CRT sinyali (WATCH + READY) üreten yardımcı ekle (crtDealingPd kurgusundan)
- [ ] 2. KOD → CRT: `signalLifecycle.test.ts`, `readyHold.test.ts`
- [ ] 3. KOD → CRT: `journal.test.ts`, `selectedSignal.test.ts`, `chartUi.test.tsx`
- [ ] 4. KOD → CRT: `geminiCommentary.test.ts`, `structureAudit.test.ts`, `scannerRequirements.test.ts`
- [ ] 5. KOD → CRT: `userRules.test.ts`, `dataFeedAndObjectives.test.ts`, `fullFlow.test.ts`
- [ ] 6. KOD → CRT: `runtimeReplay.test.ts`
- [ ] 7. `kodStrategy.test.ts` + `src/test/fixtures/kod/` sil; CLAUDE.md güncelle
- [ ] 8. Haber takvimi: ekonomik takvim JSON ayrıştırıcı + `eventCalendar`'a bağla (fikstürle test); sunucuda önbellekli `/api/calendar`
- [ ] 9. `vite.config.ts` bölme: Telegram/alert handler'ları `server/telegram.ts`'e
- [ ] 10. `vite.config.ts` bölme: Gemini handler'ları + prompt'lar `server/gemini.ts`'e
- [ ] 11. Son doğrulama: typecheck + test + build + lokal sunucu duman testi; CLAUDE.md; push

## Bana sorular
- (Adım 8) Ekonomik takvim kaynağı olarak ForexFactory'nin herkese açık haftalık JSON'unu
  (`nfs.faireconomy.media`) kullanıyorum. Bu ortamdan erişim yok, o yüzden canlıda çalıştığını
  doğrulayamıyorum; fikstürle test ediyorum. Haber filtresi şu an sadece **uyarı**; yüksek etkili
  haberde READY'yi **engellemesini** istersen söyle (davranış değişikliği).
- İş bitince: branch'teki değişiklikleri `main`'e merge edip canlıya alayım mı? (deploy = yayın)
- Kâr kanıtı (madde 15) zaman ister: birkaç hafta canlı sinyal kaydı/izleme. Bu kod işi değil.

## Günlük
- 2026-10-10 — Plan çıkarıldı. KOD'a bağlı 13 test dosyası listelendi. Takvim kaynağı
  (nfs.faireconomy.media) bu ortamdan engelli. Yedek tetik: 60 dk sonra `send_later` check-in.
- Adım 1 bitti: `createCrtShortContext` / `createCrtSignal` (strategyFixtures.ts). Gerçek motor 4H short READY (DOL RR 2.23) üretiyor; exitMinimumRR 10 → aynı setup WATCH. `crtFixture.test.ts` yeşil.
