import { assertAnyToolCalled, assertToolCalled, assertTrue, type Scenario } from "../framework.js";
import { freshSessionKey, runAgentTurn } from "../runAgent.js";
import { deleteById, findVehicleByPlate } from "../db.js";

const statusCheckUsesRelevantTools: Scenario = {
  id: "status-check-relevant-tools",
  description: '"Give me a status check" calls at least one genuinely relevant lookup tool',
  async run() {
    const result = runAgentTurn("Give me a status check", freshSessionKey("status-check"));
    assertAnyToolCalled(
      result.toolSummary.tools,
      ["list_shifts", "get_crew_status", "list_alerts"],
      "status-check-relevant-tools",
    );
  },
};

const messageCorrectionUsesLatestValue: Scenario = {
  id: "message-correction-latest-value",
  description: "A same-conversation typo correction is honored, not the original wrong value",
  async run() {
    const originalPlate = "TEST-CORRECT-1";
    const correctedPlate = "TEST-CORRECT-2";
    const sessionKey = freshSessionKey("message-correction");
    try {
      runAgentTurn(`Register a new vehicle, plate ${originalPlate}`, sessionKey);
      runAgentTurn(`sorry typo, I meant plate ${correctedPlate}`, sessionKey);
      const turn3 = runAgentTurn("yes, that's right, go ahead", sessionKey);

      assertToolCalled(turn3.toolSummary.tools, "register_vehicle", "message-correction-latest-value");

      const corrected = await findVehicleByPlate(correctedPlate);
      const original = await findVehicleByPlate(originalPlate);
      assertTrue(corrected !== null, `expected a vehicle with the corrected plate ${correctedPlate}`);
      assertTrue(original === null, `expected NO vehicle with the original wrong plate ${originalPlate}`);
    } finally {
      const corrected = await findVehicleByPlate(correctedPlate);
      const original = await findVehicleByPlate(originalPlate);
      if (corrected) await deleteById("vehicles", corrected.id);
      if (original) await deleteById("vehicles", original.id);
    }
  },
};

export const reasoningScenarios: Scenario[] = [statusCheckUsesRelevantTools, messageCorrectionUsesLatestValue];
