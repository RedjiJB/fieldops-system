import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { fetchSessionsInRange } from "../lib/timeclock.js";

export const timesheetsRouter = Router();

timesheetsRouter.get(
  "/timesheets/sessions",
  asyncHandler(async (req, res) => {
    const { crew_member_id, date_from, date_to } = req.query;
    const sessions = await fetchSessionsInRange(pool, {
      crew_member_id: crew_member_id as string | undefined,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
    });
    res.json(sessions);
  }),
);
