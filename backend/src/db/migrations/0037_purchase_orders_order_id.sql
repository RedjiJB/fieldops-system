-- purchase_orders has never recorded which order it was compiled from --
-- POST /orders/:id/compile-po already has the order id (req.params.id) but
-- never persisted it. Nullable since existing rows predate this column.
ALTER TABLE purchase_orders ADD COLUMN order_id UUID REFERENCES orders(id);
