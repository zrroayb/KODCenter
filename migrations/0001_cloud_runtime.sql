CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  symbol TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  loaded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_results (
  symbol TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_log (
  dedupe_key TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_loaded_at
  ON market_snapshots (loaded_at);

CREATE INDEX IF NOT EXISTS idx_scan_results_scanned_at
  ON scan_results (scanned_at);

CREATE INDEX IF NOT EXISTS idx_alert_log_created_at
  ON alert_log (created_at);
