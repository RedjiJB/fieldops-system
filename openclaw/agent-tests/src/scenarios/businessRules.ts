import { assertTrue, type Scenario } from "../framework.js";
import { freshSessionKey, runAgentTurn } from "../runAgent.js";
import { createAsset, createCrewMember, deleteById, pool } from "../db.js";

const checkoutRejectionHonored: Scenario = {
  id: "checkout-rejection-honored",
  description: "Checking out an unconfirmed (not available) asset never actually succeeds, whatever the agent says",
  async run() {
    const crewId = await createCrewMember("Test Checkout Rejector", "+15559990301");
    const assetId = await createAsset("Test Rejected Asset", "tool", "TEST-QR-9001", "unconfirmed");
    const sessionKey = freshSessionKey("checkout-rejection");

    try {
      runAgentTurn("Can I check out the Test Rejected Asset?", sessionKey);
      runAgentTurn("yes", sessionKey);

      // The invariant that actually matters: whatever the agent said, the
      // backend's business rule (checkout_asset only works on `available`
      // assets) must have held — no checkout row should exist for this
      // asset, and its status must not have silently changed.
      const checkouts = await pool.query("SELECT 1 FROM checkouts WHERE asset_id = $1", [assetId]);
      assertTrue((checkouts.rowCount ?? 0) === 0, "expected no checkout row for an unconfirmed asset");

      const asset = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
      assertTrue(
        asset.rows[0]?.status === "unconfirmed",
        `expected asset status to remain 'unconfirmed', got '${asset.rows[0]?.status}'`,
      );
    } finally {
      await pool.query("DELETE FROM checkouts WHERE asset_id = $1", [assetId]);
      await deleteById("assets", assetId);
      await deleteById("crew_members", crewId);
    }
  },
};

export const businessRuleScenarios: Scenario[] = [checkoutRejectionHonored];
