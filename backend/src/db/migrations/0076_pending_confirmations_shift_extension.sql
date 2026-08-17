-- Adds 'shift_extension' to the two-party confirm-before-execute pilot --
-- an extension changes payroll hours, same "crew member confirming their
-- own statement isn't independent verification" reasoning as the other
-- five action types already in this list (see AGENTS.md).
ALTER TABLE pending_confirmations DROP CONSTRAINT pending_confirmations_action_type_check;
ALTER TABLE pending_confirmations ADD CONSTRAINT pending_confirmations_action_type_check
  CHECK (action_type IN ('timeclock_event', 'consumable_adjustment', 'checkout_return', 'mileage_claim', 'asset_verification', 'purchase_order_fulfillment', 'shift_extension'));
