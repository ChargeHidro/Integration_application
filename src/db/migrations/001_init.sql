CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
  item_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  variant_code TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  position JSONB NOT NULL,
  motor_input JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX items_project_id_idx ON items (project_id);

CREATE TABLE bom_lines (
  bom_line_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE REFERENCES items (item_id) ON DELETE CASCADE,
  variant_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX bom_lines_project_id_idx ON bom_lines (project_id);

CREATE TABLE price_snapshots (
  variant_code TEXT NOT NULL,
  country CHAR(2) NOT NULL,
  customer_group TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL,
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
  valid_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (variant_code, country, customer_group)
);
