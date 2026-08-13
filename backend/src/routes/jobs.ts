import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const jobsRouter = Router();

const JOB_STATUSES = ["not_started", "in_progress", "complete"] as const;

jobsRouter.post(
  "/jobs",
  asyncHandler(async (req, res) => {
    const { site_id, job_type_id, date } = req.body;
    if (!site_id || !date) throw new HttpError(400, "site_id and date are required");

    const result = await pool.query(
      `INSERT INTO jobs (site_id, job_type_id, date) VALUES ($1, $2, $3) RETURNING *`,
      [site_id, job_type_id ?? null, date],
    );
    res.status(201).json(result.rows[0]);
  }),
);

jobsRouter.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const { date, site_id, status } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (date) {
      params.push(date);
      conditions.push(`j.date = $${params.length}`);
    }
    if (site_id) {
      params.push(site_id);
      conditions.push(`j.site_id = $${params.length}`);
    }
    if (status) {
      if (!JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number])) {
        throw new HttpError(400, `status must be one of: ${JOB_STATUSES.join(", ")}`);
      }
      params.push(status);
      conditions.push(`j.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT j.*, s.name AS site_name, jt.name AS job_type_name
       FROM jobs j
       LEFT JOIN sites s ON s.id = j.site_id
       LEFT JOIN job_types jt ON jt.id = j.job_type_id
       ${where}
       ORDER BY j.date DESC, j.created_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

jobsRouter.patch(
  "/jobs/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!JOB_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${JOB_STATUSES.join(", ")}`);
    }

    const existing = await pool.query("SELECT * FROM jobs WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) throw new HttpError(404, "Job not found");

    const currentIndex = JOB_STATUSES.indexOf(existing.rows[0].status);
    const newIndex = JOB_STATUSES.indexOf(status);
    if (newIndex <= currentIndex) {
      throw new HttpError(
        400,
        `Jobs can only advance forward: '${existing.rows[0].status}' -> '${status}' is not a forward move`,
      );
    }

    // Manual only for this phase -- auto-transition on geofence arrival is
    // future work (needs real check-in geofence verification first, which
    // doesn't exist yet either).
    const timestampColumn = status === "in_progress" ? "started_at" : status === "complete" ? "completed_at" : null;
    const actorColumn = status === "in_progress" ? "started_by" : status === "complete" ? "completed_by" : null;
    const actorUserColumn =
      status === "in_progress" ? "started_by_user_id" : status === "complete" ? "completed_by_user_id" : null;

    // Same dual-path actor convention as alerts.ts's /resolve -- a dashboard
    // session supplies the actor from auth; the agent passes changed_by.
    let actorId: string | null = null;
    let actorUserId: string | null = null;
    if (req.auth?.type === "user") {
      actorUserId = req.auth.userId;
    } else {
      const { changed_by } = req.body;
      if (!changed_by) throw new HttpError(400, "changed_by is required");
      actorId = changed_by;
    }

    const result =
      timestampColumn && actorColumn && actorUserColumn
        ? await pool.query(
            `UPDATE jobs
             SET status = $2, ${timestampColumn} = now(), ${actorColumn} = $3, ${actorUserColumn} = $4
             WHERE id = $1
             RETURNING *`,
            [req.params.id, status, actorId, actorUserId],
          )
        : await pool.query(`UPDATE jobs SET status = $2 WHERE id = $1 RETURNING *`, [req.params.id, status]);
    res.json(result.rows[0]);
  }),
);

// job_types has existed since 0003_job_types.sql (loadouts.job_type_id
// already referenced it) but never had its own endpoint -- needed so the
// agent can resolve a freeform job description to an id via list_job_types
// rather than guessing one.
jobsRouter.get(
  "/job-types",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM job_types ORDER BY name");
    res.json(result.rows);
  }),
);
