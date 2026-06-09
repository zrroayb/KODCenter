from pathlib import Path


def test_trade_style_document_records_backup_and_canonical_pdf_source():
    path = Path("docs/trade-style-backup-and-crt-master.md")
    text = path.read_text()

    assert "Legacy Backup" in text
    assert "Historical backup only" in text
    assert "Canonical Live Framework" in text
    assert "CRT Secrets Series - Book" in text
    assert "86" in text
    assert "e0f62372112170ada2f78ba79f3954ddd11eda68a8889b5964a0bde47e1c4ae6" in text
    assert "Candle 3 Model #1/MSS" in text
