CREATE TABLE loadouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  job_type_id UUID REFERENCES job_types(id)
);

CREATE TABLE loadout_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loadout_id     UUID NOT NULL REFERENCES loadouts(id) ON DELETE CASCADE,
  asset_id       UUID REFERENCES assets(id),
  consumable_id  UUID REFERENCES consumables(id),
  quantity       NUMERIC NOT NULL,
  scales_with_crew BOOLEAN NOT NULL DEFAULT false,
  CHECK (
    (asset_id IS NOT NULL AND consumable_id IS NULL) OR
    (asset_id IS NULL AND consumable_id IS NOT NULL)
  )
);
