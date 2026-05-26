CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspaces_stripe_customer_id_idx ON workspaces(stripe_customer_id);
