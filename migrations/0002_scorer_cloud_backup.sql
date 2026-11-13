-- One rolling cloud snapshot of the scorer's complete local match-history archive.
-- This row is intentionally independent of match_history so deleting a visible
-- history item does not delete the recovery snapshot.
CREATE TABLE IF NOT EXISTS scorer_cloud_backup (
  backup_id TEXT PRIMARY KEY,
  saved_at INTEGER NOT NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);
