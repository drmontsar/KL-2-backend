-- up
-- Keep the fixture clock stable between non-destructive seed runs after a reset.
CREATE TABLE test_data.datasets (
  dataset_id text PRIMARY KEY,
  snapshot_at timestamptz NOT NULL
);

-- down
DROP TABLE test_data.datasets;
