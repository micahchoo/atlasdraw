CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  blob_ref TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  workspace_id TEXT
);
CREATE INDEX IF NOT EXISTS maps_workspace_id_idx ON maps(workspace_id);
