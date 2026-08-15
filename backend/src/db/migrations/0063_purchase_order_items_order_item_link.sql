-- Closes the "requested vs. purchased" half of order->PO reconciliation.
-- purchase_order_items rows have exactly one creation path (POST
-- /orders/:id/compile-po in orders.ts, one row per order_items row, in a
-- loop) -- the link back to the specific order_item it came from was
-- already known at that moment, just never persisted, only flattened into
-- a free-text description string. Nullable and forward-only: existing
-- pre-migration rows have no way to be backfilled without parsing that
-- free text, which is exactly the fragile matching this column exists to
-- avoid -- older POs simply won't show up in reconciliation.
ALTER TABLE purchase_order_items ADD COLUMN order_item_id UUID REFERENCES order_items(id);
