import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

// Backed by a Docker volume (see docker-compose.yml) so uploads survive
// container rebuilds. Stored filenames are always generated (crypto
// randomUUID), never derived from user input, to avoid path traversal.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// mime_type is client-reported (whatever a WhatsApp sender's device claims),
// not verified against actual file bytes — allowlisting it at upload time is
// what stops someone uploading something that reports itself as text/html
// (or worse) and having it rendered inline by a browser later. Only image
// types render inline (see GET /documents/:id/file); everything else is
// forced to download regardless of what's in this list.
const SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

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

documentsRouter.post(
  "/documents/upload",
  asyncHandler(async (req, res) => {
    const {
      content_base64,
      original_filename,
      mime_type,
      site_id,
      job_id,
      type,
      uploaded_by,
      tags,
      expiry_date,
    } = req.body;

    if (!content_base64 || !original_filename || !mime_type || !uploaded_by) {
      throw new HttpError(400, "content_base64, original_filename, mime_type, and uploaded_by are required");
    }
    if (!DOCUMENT_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
    }
    // mime_type is whatever the uploading client claims — reject anything
    // outside a real document/photo allowlist rather than trusting it
    // unchecked (see SAFE_MIME_TYPES comment above for why this matters).
    if (!SAFE_MIME_TYPES.has(mime_type)) {
      throw new HttpError(400, `mime_type must be one of: ${[...SAFE_MIME_TYPES].join(", ")}`);
    }

    // Node's Buffer.from(str, "base64") never throws on malformed input — it
    // silently skips invalid characters and decodes whatever's left, so a
    // try/catch here is useless. Validate the alphabet/padding ourselves first.
    const normalized = content_base64.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
      throw new HttpError(400, "content_base64 is not valid base64");
    }
    const buffer = Buffer.from(normalized, "base64");
    if (buffer.length === 0) throw new HttpError(400, "decoded file content is empty");

    const ext = path.extname(original_filename).slice(0, 10); // cap in case of a malformed name
    const storedFilename = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedFilename), buffer);

    const result = await pool.query(
      `INSERT INTO documents (site_id, job_id, type, filename, storage_path, mime_type, uploaded_by, tags, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        site_id ?? null,
        job_id ?? null,
        type,
        original_filename,
        storedFilename,
        mime_type,
        uploaded_by,
        tags ?? null,
        expiry_date ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  }),
);

// Corrects a document's type after auto-filing -- the only mutation route on
// this table besides creation. Introduced for fieldops-media's classify_document
// tool (a photo starts out type='photo' the instant it's received, then an
// agent turn may upgrade it once it can tell what the photo actually is).
documentsRouter.patch(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const { type } = req.body;
    if (!DOCUMENT_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
    }
    const result = await pool.query(`UPDATE documents SET type = $2 WHERE id = $1 RETURNING *`, [
      req.params.id,
      type,
    ]);
    if (!result.rows[0]) throw new HttpError(404, "Document not found");
    res.json(result.rows[0]);
  }),
);

documentsRouter.get(
  "/documents/:id/file",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    const doc = result.rows[0];
    if (!doc) throw new HttpError(404, "Document not found");
    if (!doc.storage_path) throw new HttpError(404, "No file stored for this document");

    const filePath = path.join(UPLOAD_DIR, doc.storage_path);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Stored file is missing");

    // Old rows from before SAFE_MIME_TYPES existed could still carry an
    // unvalidated mime_type — never trust it enough to render inline.
    // nosniff stops the browser from ignoring our Content-Type and
    // guessing its own from the bytes, which is exactly how a mislabeled
    // upload could still end up rendered as HTML.
    const isSafeInlineType = SAFE_MIME_TYPES.has(doc.mime_type);
    res.type(isSafeInlineType ? doc.mime_type : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const disposition = isSafeInlineType && doc.mime_type.startsWith("image/") ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(doc.filename)}"`);
    fs.createReadStream(filePath).pipe(res);
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
      conditions.push(`d.site_id = $${params.length}`);
    }
    if (type) {
      if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
        throw new HttpError(400, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
      }
      params.push(type);
      conditions.push(`d.type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // Joined site name for the dashboard's documents/compliance view — same
    // reasoning as the assets browser's joined names.
    const result = await pool.query(
      `SELECT d.*, s.name AS site_name
       FROM documents d
       LEFT JOIN sites s ON s.id = d.site_id
       ${where}
       ORDER BY d.uploaded_at DESC`,
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
      `SELECT d.*, s.name AS site_name
       FROM documents d
       LEFT JOIN sites s ON s.id = d.site_id
       WHERE d.expiry_date IS NOT NULL
         AND d.expiry_date <= CURRENT_DATE + ($1 || ' days')::interval
       ORDER BY d.expiry_date`,
      [withinDays],
    );
    res.json(result.rows);
  }),
);
