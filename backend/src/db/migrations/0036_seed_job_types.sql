-- job_types has existed since 0003_job_types.sql with a "seed values"
-- comment that was never actually an INSERT -- the table's been empty this
-- whole time. Now that list_job_types/create_job give it a real caller,
-- seed the exact values the comment already documented.
INSERT INTO job_types (name) VALUES
  ('interlock_repair'),
  ('interlock_full_install'),
  ('sod_install'),
  ('sod_replacement'),
  ('irrigation_service'),
  ('seed_and_feed'),
  ('service_call'),
  ('excavation');
