-- License validation cache + audit trail.
-- Composite PK lets the same license run on multiple instances (LS enforces the cap).

CREATE TABLE IF NOT EXISTS validations (
  license_key   TEXT NOT NULL,
  instance_id   TEXT NOT NULL,
  tier          TEXT NOT NULL,             -- 'monthly' | 'yearly' | 'lifetime'
  valid         INTEGER NOT NULL,          -- 0 | 1
  expires_at    INTEGER,                   -- unix ms, NULL for lifetime
  validated_at  INTEGER NOT NULL,          -- unix ms of last successful LS hit
  variant_id    TEXT,
  PRIMARY KEY (license_key, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_validations_key ON validations(license_key);
CREATE INDEX IF NOT EXISTS idx_validations_age ON validations(validated_at);

-- Phase 5: cloud sync. piles_cloud is the server side of the LWW sync; one row per
-- license_key + pile_id. tombstones tracks deletions so other devices see them.

CREATE TABLE IF NOT EXISTS piles_cloud (
  license_key   TEXT NOT NULL,
  pile_id       INTEGER NOT NULL,
  data          TEXT NOT NULL,             -- JSON blob of full Pile (+ embedded tabs)
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (license_key, pile_id)
);

CREATE INDEX IF NOT EXISTS idx_piles_cloud_updated ON piles_cloud(license_key, updated_at);

CREATE TABLE IF NOT EXISTS tombstones (
  license_key   TEXT NOT NULL,
  pile_id       INTEGER NOT NULL,
  deleted_at    INTEGER NOT NULL,
  PRIMARY KEY (license_key, pile_id)
);

CREATE INDEX IF NOT EXISTS idx_tombstones_deleted ON tombstones(license_key, deleted_at);
