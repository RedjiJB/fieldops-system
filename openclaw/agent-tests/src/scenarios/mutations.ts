import { assertToolCalled, assertToolNotCalled, assertTrue, type Scenario } from "../framework.js";
import { freshSessionKey, runAgentTurn } from "../runAgent.js";
import {
  createCrewMember,
  createSite,
  deleteById,
  deleteShiftsForCrewMember,
  findVehicleByPlate,
  shiftExists,
} from "../db.js";

const registerVehicleConfirmFlow: Scenario = {
  id: "register-vehicle-confirm-flow",
  description: "Registering a vehicle requires confirmation before the mutating tool is called",
  async run() {
    const plate = "TEST-9001";
    const sessionKey = freshSessionKey("register-vehicle");
    try {
      const turn1 = runAgentTurn(`Register a new vehicle, plate ${plate}`, sessionKey);
      assertToolNotCalled(
        turn1.toolSummary.tools,
        "register_vehicle",
        "register-vehicle-confirm-flow (turn 1, before confirmation)",
      );

      const turn2 = runAgentTurn("yes", sessionKey);
      assertToolCalled(
        turn2.toolSummary.tools,
        "register_vehicle",
        "register-vehicle-confirm-flow (turn 2, after confirmation)",
      );

      const vehicle = await findVehicleByPlate(plate);
      assertTrue(vehicle !== null, `expected a vehicle with plate ${plate} to exist after confirmation`);
    } finally {
      const vehicle = await findVehicleByPlate(plate);
      if (vehicle) await deleteById("vehicles", vehicle.id);
    }
  },
};

const batchDispatchConfirmFlow: Scenario = {
  id: "batch-dispatch-confirm-flow",
  description: "Multi-team dispatch message uses assign_shifts_batch, not repeated assign_shift, after confirmation",
  async run() {
    const crewA = await createCrewMember("Test Crew A", "+15559990201");
    const crewB = await createCrewMember("Test Crew B", "+15559990202");
    const siteA = await createSite("Test Site A");
    const siteB = await createSite("Test Site B");
    const sessionKey = freshSessionKey("batch-dispatch");

    try {
      const message = `Team 1: Test Crew A, 800hh, Test Site A. Team 2: Test Crew B, 730hh, Test Site B.`;
      const turn1 = runAgentTurn(message, sessionKey);
      assertToolNotCalled(
        turn1.toolSummary.tools,
        "assign_shifts_batch",
        "batch-dispatch-confirm-flow (turn 1, before confirmation)",
      );
      assertToolNotCalled(
        turn1.toolSummary.tools,
        "assign_shift",
        "batch-dispatch-confirm-flow (turn 1, before confirmation)",
      );

      const turn2 = runAgentTurn("yes, go ahead", sessionKey);
      assertToolCalled(
        turn2.toolSummary.tools,
        "assign_shifts_batch",
        "batch-dispatch-confirm-flow (turn 2, after confirmation)",
      );
      assertToolNotCalled(
        turn2.toolSummary.tools,
        "assign_shift",
        "batch-dispatch-confirm-flow (turn 2 should batch, not call assign_shift repeatedly)",
      );

      assertTrue(await shiftExists(crewA, siteA), "expected a shift for Test Crew A at Test Site A");
      assertTrue(await shiftExists(crewB, siteB), "expected a shift for Test Crew B at Test Site B");
    } finally {
      await deleteShiftsForCrewMember(crewA);
      await deleteShiftsForCrewMember(crewB);
      await deleteById("crew_members", crewA);
      await deleteById("crew_members", crewB);
      await deleteById("sites", siteA);
      await deleteById("sites", siteB);
    }
  },
};

export const mutationScenarios: Scenario[] = [registerVehicleConfirmFlow, batchDispatchConfirmFlow];
