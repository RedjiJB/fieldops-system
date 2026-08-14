import type { Request } from "express";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { raiseAlert } from "../workers/exceptions.js";

export const systemRouter = Router();

function requireServiceToken(req: Request) {
  if (req.auth?.type !== "service") {
    throw new HttpError(403, "Only the agent service token can do this");
  }
}

systemRouter.get(
  "/system/dashboard-url",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT url, reachable, checked_at, updated_at FROM dashboard_url LIMIT 1",
    );
    res.json(result.rows[0]);
  }),
);

systemRouter.patch(
  "/system/dashboard-url",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { url } = req.body;
    if (!url) throw new HttpError(400, "url is required");
    await pool.query("UPDATE dashboard_url SET url = $1, updated_at = now()", [url]);
    res.json({ ok: true });
  }),
);

// Drives the dashboard_unreachable alert -- reuses the exceptions worker's
// own raiseAlert (same dedup-while-unresolved semantics as every other
// exception check) rather than a separate alerting path. Never
// auto-resolves on recovery, same convention as the rest of that worker --
// a human confirms via the Alerts page.
systemRouter.post(
  "/system/dashboard-url/health",
  asyncHandler(async (req, res) => {
    requireServiceToken(req);
    const { reachable } = req.body;
    if (typeof reachable !== "boolean") throw new HttpError(400, "reachable (boolean) is required");

    const result = await pool.query(
      "UPDATE dashboard_url SET reachable = $1, checked_at = now() RETURNING id",
      [reachable],
    );
    const row = result.rows[0];

    if (!reachable) {
      const client = await pool.connect();
      try {
        await raiseAlert(client, "dashboard_unreachable", null, row.id);
      } finally {
        client.release();
      }
    }
    res.json({ ok: true });
  }),
);
