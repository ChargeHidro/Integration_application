ALTER TABLE price_snapshots ADD COLUMN fetched_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE catalogue_variants (
  variant_code TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sizing_results (
  input_hash TEXT NOT NULL,
  api_version TEXT NOT NULL,
  variant_code TEXT NOT NULL,
  load_pct NUMERIC(7, 2) NOT NULL CHECK (load_pct >= 0),
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (input_hash, api_version)
);
