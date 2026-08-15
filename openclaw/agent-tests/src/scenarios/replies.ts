// Two flows that share a shape distinct from every other scenario in this
// suite: the system reaches out first (a pushed critical notification, a
// shift nudge), and these test the *reply* to that outbound message, not a
// fresh inbound request. Both are single-turn, no confirm-before-execute
// step -- see AGENTS.md's "Acknowledging critical notifications" and "A
// shift can only be confirmed or declined once." The shift-confirm scenario
// can't literally simulate the priming nudge message itself landing in the
// agent's own session (this harness has no way to inject a system-originated
// message into conversation history) -- see its own comment.
import { assertToolCalled, assertToolNotCalled, assertTrue, type Scenario } from "../framework.js";
import { fromPhone, freshSessionKey, runAgentTurn } from "../runAgent.js";
import {
  countOpenCriticalNotifications,
  createCrewMember,
  createNotification,
  createShift,
  createSite,
  deleteById,
  deleteShiftsForCrewMember,
  getNotificationAck,
  getShiftStatus,
} from "../db.js";

const acknowledgeSingleOpenCritical: Scenario = {
  id: "acknowledge-single-open-critical",
  description: "A short affirmative reply acknowledges the one open critical notification, not resolve_alert",
  async run() {
    const phone = "+15559990301";
    // "Exactly one open critical" is the whole heuristic under test (per
    // AGENTS.md) -- a genuine unrelated real alert being open at the same
    // time (this runs against the live Pi, not an isolated database) would
    // correctly make the agent list-and-ask instead of guess. Check first
    // so that case produces a clear diagnostic, not a confusing
    // tool-mismatch failure that looks like a regression but isn't one.
    const preExisting = await countOpenCriticalNotifications();
    assertTrue(
      preExisting === 0,
      `acknowledge-single-open-critical: expected zero pre-existing open critical notifications, found ${preExisting} -- resolve/acknowledge those first, this scenario's "exactly one" precondition depends on it`,
    );

    const crewMemberId = await createCrewMember("Test Ack Management", phone, "management");
    const notificationId = await createNotification("🚨 Test Overdue Compactor is overdue for return.");
    try {
      const result = runAgentTurn(fromPhone(phone, "on it"), freshSessionKey("ack-single-critical"));
      assertToolCalled(result.toolSummary.tools, "acknowledge_notification", "acknowledge-single-open-critical");
      assertToolNotCalled(
        result.toolSummary.tools,
        "resolve_alert",
        "acknowledge-single-open-critical (acknowledging must never resolve the underlying alert)",
      );

      const ack = await getNotificationAck(notificationId);
      assertTrue(ack.acknowledged_at !== null, "expected the notification to be acknowledged in the database");
      assertTrue(
        ack.acknowledged_by === crewMemberId,
        `expected acknowledged_by to be ${crewMemberId}, got ${ack.acknowledged_by}`,
      );
    } finally {
      await deleteById("notifications", notificationId);
      await deleteById("crew_members", crewMemberId);
    }
  },
};

const shiftConfirmReplyFlow: Scenario = {
  id: "shift-confirm-reply-flow",
  description: "An affirmative shift-confirmation message calls confirm_shift and the shift moves to confirmed",
  async run() {
    const phone = "+15559990302";
    const crewMemberId = await createCrewMember("Test Confirm Reply", phone);
    const siteId = await createSite("Test Site Confirm Reply");
    // Tomorrow, matching nudge-shifts.mjs's own "shift for tomorrow" scope --
    // an already-past shift wouldn't be a realistic confirm-reply target.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const shiftId = await createShift(crewMemberId, siteId, tomorrow);
    try {
      // A bare "CONFIRM" with zero prior context in the session is
      // genuinely ambiguous -- AGENTS.md has no magic-keyword rule for it,
      // and the real flow only works because nudge-shifts.mjs's own "reply
      // CONFIRM or DECLINE" message already sits in that WhatsApp thread
      // before the crew member replies. This suite has no way to simulate
      // that system-originated priming message landing in the agent's own
      // session, so the message here carries the same context a real reply
      // would lean on implicitly -- testing the same underlying tool
      // selection without depending on unconfirmed context-propagation
      // behavior this harness can't verify either way.
      const message = "Confirming I can make my shift tomorrow";
      const result = runAgentTurn(fromPhone(phone, message), freshSessionKey("shift-confirm-reply"));
      assertToolCalled(result.toolSummary.tools, "confirm_shift", "shift-confirm-reply-flow");

      const status = await getShiftStatus(shiftId);
      assertTrue(status === "confirmed", `expected shift status to be confirmed, got ${status}`);
    } finally {
      await deleteShiftsForCrewMember(crewMemberId);
      await deleteById("crew_members", crewMemberId);
      await deleteById("sites", siteId);
    }
  },
};

export const replyScenarios: Scenario[] = [acknowledgeSingleOpenCritical, shiftConfirmReplyFlow];
