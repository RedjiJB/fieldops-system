-- Per-day/provider/model token+cost aggregate -- the underlying data
-- (every agent turn's usage/cost) already exists in each session's .jsonl
-- transcript on the Pi host, just never aggregated anywhere. Rows are
-- computed and UPSERTed wholesale by openclaw/notifier/sync-model-usage.mjs,
-- not accumulated incrementally -- the backend only ever stores what the
-- script hands it.
CREATE TABLE model_usage_daily (
  date               DATE NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       BIGINT NOT NULL DEFAULT 0,
  output_tokens      BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens  BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  reasoning_tokens   BIGINT NOT NULL DEFAULT 0,
  total_tokens       BIGINT NOT NULL DEFAULT 0,
  cost_usd           NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (date, provider, model)
);
