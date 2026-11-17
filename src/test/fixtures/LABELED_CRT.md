# Elle etiketli CRT örnekleri (sahibi doldurur)

`labeledCrt.json` = sahibinin grafikte "bu CRT / bu değil" diye işaretlediği örnekler. Motorun
kaynağa uyumunu kendi kural metnimizden bağımsız sınamanın yolu. **Örnekler uydurulmaz.**

Her kayıt:

```json
{
  "symbol": "EURUSD",
  "rangeTf": "4h",
  "c1Time": "2026-10-14T13:00:00Z",
  "direction": "short",
  "crt": true,
  "note": "C2 London açılışında high'ı süpürdü, içeride kapandı"
}
```

- `symbol`: `src/lib/ict/symbolSpec.ts`'teki sembol adı.
- `rangeTf`: `4h` | `1d` | `1w` | `1M`.
- `c1Time`: Candle 1'in AÇILIŞ zamanı, UTC, ISO. FX/altın/NAS'ta 4H ve günlük mumlar NY 17:00
  kapanışına hizalı (ör. 4H: 21/01/05/09/13/17 UTC kışın 22/02/...).
- `direction`: `long` | `short` (CRT değilse de beklenen yön yazılabilir; boş bırakılabilir).
- `crt`: `true` = geçerli CRT (C2 tek tarafı fitille süpürdü, range içinde kapandı), `false` = değil.
- `note`: kısa açıklama.

Mumlar: test, aynı sembolün mumlarını `labeledCrtMarkets.json` dosyasından okur (CRT huni
workflow'unun `markets.json` çıktısı; GitHub Actions → CRT funnel measurement → artifact
`crt-funnel`). Etiket varken bu dosya yoksa test açık bir hatayla durur.

Karşılaştırılan şey motorun **CRT tespiti**dir (C1/C2 sweep + C2'nin içeride kapanışı,
`detectAnchorRaid`), READY kapıları değil.
