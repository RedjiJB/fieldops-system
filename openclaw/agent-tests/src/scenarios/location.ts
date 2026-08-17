import { assertToolCalled, assertToolNotCalled, assertTrue, type Scenario } from "../framework.js";
import { fromPhone, freshSessionKey, runAgentTurn } from "../runAgent.js";
import {
  createCrewMember,
  createVehicle,
  crewTelemetryExists,
  deleteById,
  deleteCrewTelemetry,
  deleteVehicleTelemetry,
  vehicleTelemetryExists,
} from "../db.js";

// Matches AGENTS.md's documented format for what a WhatsApp location share
// looks like in the message body once OpenClaw formats it — confirmed
// against the actual formatLocationText source earlier in this project.
const LOCATION_TEXT = "📍 45.421500, -75.697200";

const locationWithVehicle: Scenario = {
  id: "location-with-vehicle",
  description: "A crew member with an assigned vehicle sharing a location logs it against that vehicle",
  async run() {
    const phone = "+15559990401";
    const crewId = await createCrewMember("Test Driver With Vehicle", phone);
    const vehicleId = await createVehicle("TEST-LOC-1", crewId);
    try {
      const result = runAgentTurn(fromPhone(phone, LOCATION_TEXT), freshSessionKey("location-with-vehicle"));
      assertToolCalled(result.toolSummary.tools, "list_vehicles", "location-with-vehicle");
      assertToolCalled(result.toolSummary.tools, "log_vehicle_location", "location-with-vehicle");
      // AGENTS.md: a location share always logs to crew_telemetry for the
      // sender too, in addition to log_vehicle_location when a match exists
      // -- both can be true at once.
      assertToolCalled(result.toolSummary.tools, "log_crew_location", "location-with-vehicle");
      assertTrue(
        await vehicleTelemetryExists(vehicleId),
        "expected a vehicle_telemetry row for the assigned vehicle",
      );
      assertTrue(await crewTelemetryExists(crewId), "expected a crew_telemetry row for the sender");
    } finally {
      await deleteVehicleTelemetry(vehicleId);
      await deleteCrewTelemetry(crewId);
      await deleteById("vehicles", vehicleId);
      await deleteById("crew_members", crewId);
    }
  },
};

const locationWithoutVehicle: Scenario = {
  id: "location-without-vehicle",
  description:
    "A crew member with no assigned vehicle sharing a location logs to crew_telemetry, not a fabricated vehicle log",
  async run() {
    const phone = "+15559990402";
    const crewId = await createCrewMember("Test Driver No Vehicle", phone);
    try {
      const result = runAgentTurn(fromPhone(phone, LOCATION_TEXT), freshSessionKey("location-no-vehicle"));
      assertToolCalled(result.toolSummary.tools, "list_vehicles", "location-without-vehicle");
      assertToolNotCalled(result.toolSummary.tools, "log_vehicle_location", "location-without-vehicle");
      assertToolCalled(result.toolSummary.tools, "log_crew_location", "location-without-vehicle");
      assertTrue(await crewTelemetryExists(crewId), "expected a crew_telemetry row for the sender");
    } finally {
      await deleteCrewTelemetry(crewId);
      await deleteById("crew_members", crewId);
    }
  },
};

export const locationScenarios: Scenario[] = [locationWithVehicle, locationWithoutVehicle];
