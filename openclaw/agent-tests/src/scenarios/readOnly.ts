import { assertToolCalled, assertToolNotCalled, type Scenario } from "../framework.js";
import { fromPhone, freshSessionKey, runAgentTurn } from "../runAgent.js";
import { createCrewMember, createSite, deleteById, deleteShiftsForCrewMember, pool } from "../db.js";

const listSites: Scenario = {
  id: "list-sites",
  description: '"What sites do we have?" calls list_sites',
  async run() {
    const result = runAgentTurn("What sites do we have?", freshSessionKey("list-sites"));
    assertToolCalled(result.toolSummary.tools, "list_sites", "list-sites");
  },
};

const identityShiftLookup: Scenario = {
  id: "identity-shift-lookup",
  description: "Known crew member asking about their own shift resolves identity then looks up shifts",
  async run() {
    const phone = "+15559990101";
    const crewMemberId = await createCrewMember("Test Identity Known", phone);
    const siteId = await createSite("Test Site Identity");
    await pool.query(
      "INSERT INTO shifts (crew_member_id, site_id, date, start_time) VALUES ($1, $2, CURRENT_DATE, '07:00')",
      [crewMemberId, siteId],
    );
    try {
      const result = runAgentTurn(
        fromPhone(phone, "what's my shift today"),
        freshSessionKey("identity-shift"),
      );
      assertToolCalled(result.toolSummary.tools, "list_crew_members", "identity-shift-lookup");
      assertToolCalled(result.toolSummary.tools, "list_shifts", "identity-shift-lookup");
    } finally {
      await deleteShiftsForCrewMember(crewMemberId);
      await deleteById("crew_members", crewMemberId);
      await deleteById("sites", siteId);
    }
  },
};

const unknownPhoneNoGuess: Scenario = {
  id: "unknown-phone-no-guess",
  description: "Unrecognized sender phone: agent looks it up but does not guess/answer a shift question",
  async run() {
    const phone = "+15559990102"; // deliberately never registered
    const result = runAgentTurn(fromPhone(phone, "what's my shift today"), freshSessionKey("unknown-phone"));
    assertToolCalled(result.toolSummary.tools, "list_crew_members", "unknown-phone-no-guess");
    assertToolNotCalled(result.toolSummary.tools, "list_shifts", "unknown-phone-no-guess");
  },
};

export const readOnlyScenarios: Scenario[] = [listSites, identityShiftLookup, unknownPhoneNoGuess];
