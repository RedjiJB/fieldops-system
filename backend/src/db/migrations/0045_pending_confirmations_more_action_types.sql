ALTER TABLE pending_confirmations DROP CONSTRAINT pending_confirmations_action_type_check;
ALTER TABLE pending_confirmations ADD CONSTRAINT pending_confirmations_action_type_check
  CHECK (action_type IN ('timeclock_event', 'consumable_adjustment', 'checkout_return', 'mileage_claim', 'asset_verification', 'purchase_order_fulfillment'));
