CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id),
  mode TEXT NOT NULL DEFAULT 'read',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  workspace_id TEXT
);
CREATE INDEX IF NOT EXISTS share_tokens_map_id_idx ON share_tokens(map_id);
