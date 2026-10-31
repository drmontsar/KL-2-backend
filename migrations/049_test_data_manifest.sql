-- up
CREATE SCHEMA IF NOT EXISTS test_data;
CREATE TABLE test_data.seed_records (
  dataset_id text NOT NULL,
  table_name text NOT NULL,
  record_key text NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, table_name, record_key)
);

-- down
DROP TABLE IF EXISTS test_data.seed_records;
DROP SCHEMA IF EXISTS test_data;
