import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { requireAdmin } from "../lib/roles.js";

export const notificationSettingsRouter = Router();

// Same role list crew_members.role validates against (backend/src/routes/crewMembers.ts) --
// duplicated rather than imported, matching this codebase's existing convention of each
// file keeping its own small const array rather than a shared central module.
const CREW_ROLES = ["crew", "foreman", "yard", "management", "owner"] as const;

// Dual-path, same reasoning as GET /pending-confirmations and GET /notifications/pending:
// a dashboard session must be admin, but the agent's service token passes through
// ungated, since openclaw/notifier/deliver-notifications.mjs (host-side, no DB access)
// needs critical_notification_roles fresh every run.
notificationSettingsRouter.get(
  "/notification-settings",
  asyncHandler(async (req, res) => {
    if (req.auth?.type === "user") requireAdmin(req);
    const result = await pool.query("SELECT * FROM notification_settings LIMIT 1");
    res.json(result.rows[0]);
  }),
);

// Dashboard-only write -- unlike the GET above, there's no agent-facing use
// case for changing these values, only viewing them.
notificationSettingsRouter.patch(
  "/notification-settings",
  asyncHandler(async (req, res) => {
    requireAdmin(req);

    const {
      escalation_threshold_minutes,
      max_escalations,
      vehicle_dark_critical,
      critical_notification_roles,
      order_stall_hours,
      idle_hours,
      delay_buffer_minutes,
      rain_probability_threshold,
      wind_speed_threshold_kmh,
      daily_overtime_hours,
      break_required_after_hours,
    } = req.body;

    const positiveIntFields: Record<string, number | undefined> = {
      escalation_threshold_minutes,
      max_escalations,
      order_stall_hours,
      idle_hours,
      delay_buffer_minutes,
      daily_overtime_hours,
      break_required_after_hours,
    };
    for (const [field, value] of Object.entries(positiveIntFields)) {
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        throw new HttpError(400, `${field} must be a positive integer`);
      }
    }

    const percentFields: Record<string, number | undefined> = { rain_probability_threshold };
    for (const [field, value] of Object.entries(percentFields)) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 100)) {
        throw new HttpError(400, `${field} must be an integer between 0 and 100`);
      }
    }

    if (
      wind_speed_threshold_kmh !== undefined &&
      (!Number.isInteger(wind_speed_threshold_kmh) || wind_speed_threshold_kmh <= 0)
    ) {
      throw new HttpError(400, "wind_speed_threshold_kmh must be a positive integer");
    }

    if (vehicle_dark_critical !== undefined && typeof vehicle_dark_critical !== "boolean") {
      throw new HttpError(400, "vehicle_dark_critical must be a boolean");
    }

    if (critical_notification_roles !== undefined) {
      if (!Array.isArray(critical_notification_roles) || critical_notification_roles.length === 0) {
        throw new HttpError(400, "critical_notification_roles must be a non-empty array");
      }
      for (const role of critical_notification_roles) {
        if (!CREW_ROLES.includes(role)) {
          throw new HttpError(400, `critical_notification_roles: invalid role "${role}" -- must be one of: ${CREW_ROLES.join(", ")}`);
        }
      }
    }

    const result = await pool.query(
      `UPDATE notification_settings SET
         escalation_threshold_minutes = COALESCE($1, escalation_threshold_minutes),
         max_escalations = COALESCE($2, max_escalations),
         vehicle_dark_critical = COALESCE($3, vehicle_dark_critical),
         critical_notification_roles = COALESCE($4, critical_notification_roles),
         order_stall_hours = COALESCE($5, order_stall_hours),
         idle_hours = COALESCE($6, idle_hours),
         delay_buffer_minutes = COALESCE($7, delay_buffer_minutes),
         rain_probability_threshold = COALESCE($8, rain_probability_threshold),
         wind_speed_threshold_kmh = COALESCE($9, wind_speed_threshold_kmh),
         daily_overtime_hours = COALESCE($10, daily_overtime_hours),
         break_required_after_hours = COALESCE($11, break_required_after_hours),
         updated_at = now()
       RETURNING *`,
      [
        escalation_threshold_minutes ?? null,
        max_escalations ?? null,
        vehicle_dark_critical ?? null,
        critical_notification_roles ?? null,
        order_stall_hours ?? null,
        idle_hours ?? null,
        delay_buffer_minutes ?? null,
        rain_probability_threshold ?? null,
        wind_speed_threshold_kmh ?? null,
        daily_overtime_hours ?? null,
        break_required_after_hours ?? null,
      ],
    );
    res.json(result.rows[0]);
  }),
);
