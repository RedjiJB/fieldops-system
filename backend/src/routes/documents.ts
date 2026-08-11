import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";

export const documentsRouter = Router();

// Matches the type comment on the documents table in DATABASE_SCHEMA.md.
const DOCUMENT_TYPES = [
  "contract",
  "permit",
  "photo",
  "receipt",
  "disposal_ticket",
  "insurance_cert",
] as const;

documentsRouter.post(
  "/documents",
  asyncHandler(async (req, res) => {
    const { site_id, job_id, type, filename, uploaded_by, tags, expiry_date } = req.body;
    if (!filename || !uploaded_by) {
      throw new HttpError(400, "filename and uploaded_by are required");
    }
    if (!DOCUMENT_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
    }

    const result = await pool.query(
      `INSERT INTO documents (site_id, job_id, type, filename, uploaded_by, tags, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        site_id ?? null,
        job_id ?? null,
        type,
        filename,
        uploaded_by,
        tags ?? null,
        expiry_date ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  }),
);

documentsRouter.get(
  "/documents",
  asyncHandler(async (req, res) => {
    const { site_id, type } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (site_id) {
      params.push(site_id);
      conditions.push(`site_id = $${params.length}`);
    }
    if (type) {
      if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
        throw new HttpError(400, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
      }
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT * FROM documents ${where} ORDER BY uploaded_at DESC`,
      params,
    );
    res.json(result.rows);
  }),
);

documentsRouter.get(
  "/documents/expiring",
  asyncHandler(async (req, res) => {
    const withinDays = Number(req.query.within_days);
    if (!Number.isInteger(withinDays) || withinDays <= 0) {
      throw new HttpError(400, "within_days (positive integer) query param is required");
    }

    // Includes anything already past its expiry, not just upcoming — an
    // expired insurance cert is more urgent than one expiring next week.
    const result = await pool.query(
      `SELECT * FROM documents
       WHERE expiry_date IS NOT NULL
         AND expiry_date <= CURRENT_DATE + ($1 || ' days')::interval
       ORDER BY expiry_date`,
      [withinDays],
    );
    res.json(result.rows);
  }),
);
