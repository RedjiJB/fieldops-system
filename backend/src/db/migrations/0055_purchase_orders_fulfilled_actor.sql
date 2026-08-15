ALTER TABLE purchase_orders ADD COLUMN fulfilled_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN fulfilled_by UUID REFERENCES crew_members(id);
ALTER TABLE purchase_orders ADD COLUMN fulfilled_by_user_id UUID REFERENCES users(id);
