from tradebot.kod import enrich_alert_grade


def test_enrich_alert_grade_from_legacy_kalite_puani():
    alert = {
        "stage": "forming",
        "details": [
            "Kalite puanı: 1/3",
            "Fiyat bölgesi: pahalı bölge (uygun)",
            "Mum yapısı: uygun değil",
        ],
        "trade_plan": {},
    }

    enriched = enrich_alert_grade(alert)
    assert enriched["trade_plan"]["setup_grade"] == "CB"
    assert enriched["trade_plan"]["setup_action"]
