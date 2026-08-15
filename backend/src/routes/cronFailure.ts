import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { raiseAlert } from "../workers/exceptions.js";

// Same reasoning as /auth/login's rate limit -- this is a public,
// secret-in-query endpoint (not session/service-token gated), so it's a
// brute-force target even though the secret itself is a long random token.
const cronFailureRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Mounted BEFORE requireAuth, deliberately -- this is hit by openclaw's own
// cron failure-alert webhook delivery, not a logged-in session or a tool
// call carrying the service Authorization header (outbound webhook POSTs
// have no documented way to attach one). Auth is instead a shared secret in
// the URL query string, reusing AGENT_SERVICE_TOKEN rather than minting a
// second secret to manage -- set per job via
// `--failure-alert-to ".../system/cron-failure?secret=...&job_id=...&job_name=..."`.
//
// Exists to close a real leak: with no delivery.failureDestination
// configured, a cron job's failure notification falls back to its normal
// announce target -- for the fieldops-digest-morning/evening jobs, that's
// a WhatsApp number, and the fallback content is the RAW error (agent
// directory paths, sqlite auth store location, re-authenticate commands).
// This route intentionally never relays anything from the request body
// into the alert message -- only the job_id/job_name query params, which
// are values *we* chose when configuring the job, not anything openclaw's
// webhook payload supplied -- so there's no path for infra detail to reach
// a human-visible notification even if the payload shape changes upstream.
export const cronFailureRouter = Router();

cronFailureRouter.post(
  "/system/cron-failure",
  cronFailureRateLimit,
  asyncHandler(async (req, res) => {
    const expected = process.env.AGENT_SERVICE_TOKEN;
    if (!expected || req.query.secret !== expected) throw new HttpError(403, "Invalid secret");

    const jobId = req.query.job_id;
    const jobName = req.query.job_name;
    if (typeof jobId !== "string" || typeof jobName !== "string" || !jobId || !jobName) {
      throw new HttpError(400, "job_id and job_name are required");
    }

    const client = await pool.connect();
    try {
      await raiseAlert(client, "cron_job_failed", null, jobId, `🚨 Scheduled check "${jobName}" failed to run.`);
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);
