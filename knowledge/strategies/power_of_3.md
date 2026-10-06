# Power of 3 (AMD) — CRT için alınanlar

Kaynak: [MobiusQuant/OpenMobius-skill](https://github.com/MobiusQuant/OpenMobius-skill) bilgi tabanı
(Apache-2.0; ICT eğitim videolarından derlenmiş kavram kartları: *Accumulation Manipulation
Distribution*, *Candle Two Closure*, *Candle 3*, *Candle 3 Expansion*, *4-Hour Candle OHLC Trading
Model*, *Judas Swing*, *Manipulation Leg*, *Weekly Profile*). Burada yalnız bizim CRT kurallarımızla
(`crt_secrets_rules.md`) **çelişmeyen** ve işe yarayan kısımlar Türkçe özetlendi. Çelişki olursa
`crt_secrets_rules.md` kazanır.

## CRT ↔ Power of 3 eşlemesi
- **C1 = Accumulation** (range), **C2 = Manipulation** (bir ucu süpürür, içeride kapanır),
  **C3 = Distribution** (asıl hareket; işlem burada).
- Boğa C3 **OLHC** (açılış → önce düşük → sonra yüksek → kapanış), ayı C3 **OHLC**: C3'ün ters
  fitili mumun **başında** oluşur, sonra gövde genişler.

## Alınan kurallar
1. **C2 kapanışı + LTF CSD birlikte şart.** C2 kapanışı tek başına ya da LTF kırılımı tek başına
   yetmez; CSD'siz C2 genelde konsolidasyonla biter. → Motorda zaten var (C2 kapanış blocker'ı +
   ChoCH/True MSS zorunlu).
2. **Manipülasyon agresif geri dönüş ister.** Süpürüp yavaşça içeri sürünen hareket manipülasyon
   değil. → Motorda displacement kalite kalemi + reclaim şartı.
3. **C3'ün fitili erken oluşmalı.** C3'ün ikinci yarısında dolan giriş, genişleme için az süre
   bırakır. → **Yeni:** motorda kalite uyarısı (`candle3Progress > 0.5`), kapı değil.
4. **C2'nin büyük ters fitili C3 genişlemesini sınırlar**, küçük fitil tam genişlemeyi destekler.
   → Gemini bilgisine eklendi (ölçülebilir bir eşik kaynakta net olmadığı için motorda yok).
5. **Stop = manipülasyon ucunun ötesi.** → Motorda zaten böyle.
6. **Range içinde işlem yapma, manipülasyon hareketini kovalama.** → Gemini bilgisine eklendi.

## Bilinçli olarak ALINMAYANLAR
- Belirli saatlere bağlı kurallar (Judas Swing için 00:00 / 8:30 / 9:30 / 10:00 / 14:00,
  Asya-Londra-NY = A-M-D eşlemesi, Silver Bullet saati): CRT Secrets mekanik saat kuralını reddediyor.
- Fibonacci standart sapma hedefleri (−2 / −2.5 / −4): bizim hedef modelimiz DOL = karşı uç,
  EQ'da BE. Replay verisi aksini göstermeden değiştirilmez.
- Range sınırını gövdeyle çizmek: bizim kaynak wick (uç) kullanıyor.
