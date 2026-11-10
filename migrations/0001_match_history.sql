CREATE TABLE IF NOT EXISTS match_history (
  match_id TEXT PRIMARY KEY,
  team_a TEXT,
  team_b TEXT,
  match_name TEXT,
  status TEXT NOT NULL DEFAULT 'live',
  result TEXT,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_history_updated ON match_history(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_status ON match_history(status, completed_at DESC);
