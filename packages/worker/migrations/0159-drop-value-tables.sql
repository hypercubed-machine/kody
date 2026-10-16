-- Values are retired. Drop entries first (FK to value_buckets), then the
-- buckets table (indexes go with each table).
DROP TABLE IF EXISTS value_entries;
DROP TABLE IF EXISTS value_buckets;
