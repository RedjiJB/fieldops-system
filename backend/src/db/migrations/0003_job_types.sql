CREATE TABLE job_types (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
  -- seed values: interlock_repair, interlock_full_install, sod_install,
  -- sod_replacement, irrigation_service, seed_and_feed, service_call, excavation
);
