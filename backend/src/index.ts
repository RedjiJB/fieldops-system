import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pool } from "./db/pool.js";
import { HttpError } from "./lib/httpError.js";
import { activityRouter } from "./routes/activity.js";
import { alertsRouter } from "./routes/alerts.js";
import { assetsRouter } from "./routes/assets.js";
import { authRouter } from "./routes/auth.js";
import { checkoutsRouter } from "./routes/checkouts.js";
import { confirmationsRouter } from "./routes/confirmations.js";
import { consumablesRouter } from "./routes/consumables.js";
import { crewMembersRouter } from "./routes/crewMembers.js";
import { documentsRouter } from "./routes/documents.js";
import { jobsRouter } from "./routes/jobs.js";
import { loadoutsRouter } from "./routes/loadouts.js";
import { meRouter } from "./routes/me.js";
import { notificationSettingsRouter } from "./routes/notificationSettings.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ordersRouter } from "./routes/orders.js";
import { payrollRouter } from "./routes/payroll.js";
import { reportsRouter } from "./routes/reports.js";
import { shiftsRouter } from "./routes/shifts.js";
import { sitesRouter } from "./routes/sites.js";
import { spendingRouter } from "./routes/spending.js";
import { systemRouter } from "./routes/system.js";
import { timesheetsRouter } from "./routes/timesheets.js";
import { usersRouter } from "./routes/users.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { vendorsRouter } from "./routes/vendors.js";
import { startExceptionsWorker } from "./workers/exceptions.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
// Defaults only -- this is a pure JSON API (the one HTML-adjacent surface,
// GET /documents/:id/file, already sets its own nosniff/Content-Disposition
// per-response in documents.ts, and helmet's defaults don't fight that).
// Found missing during a security audit; the frontend (nginx) gets the
// matching CSP/frame/nosniff headers separately, see frontend/nginx.conf.
app.use(helmet());
// Default express.json() limit (100kb) is too small for base64-encoded
// photo uploads (POST /documents/upload) — WhatsApp images are typically
// a few hundred KB to a few MB, and base64 inflates that by ~33%.
app.use(express.json({ limit: "15mb" }));

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

app.use("/api/v1", authRouter);
app.use("/api/v1", requireAuth);
app.use("/api/v1", assetsRouter);
app.use("/api/v1", consumablesRouter);
app.use("/api/v1", sitesRouter);
app.use("/api/v1", loadoutsRouter);
app.use("/api/v1", checkoutsRouter);
app.use("/api/v1", ordersRouter);
app.use("/api/v1", vendorsRouter);
app.use("/api/v1", shiftsRouter);
app.use("/api/v1", alertsRouter);
app.use("/api/v1", vehiclesRouter);
app.use("/api/v1", documentsRouter);
// payrollRouter must be mounted before crewMembersRouter -- its
// GET/PATCH /crew-members/pay-profiles(/:id) routes would otherwise be
// shadowed by crewMembersRouter's GET /crew-members/:id, which greedily
// matches "pay-profiles" as an :id and 400s on the invalid UUID.
app.use("/api/v1", payrollRouter);
app.use("/api/v1", crewMembersRouter);
app.use("/api/v1", notificationsRouter);
app.use("/api/v1", notificationSettingsRouter);
app.use("/api/v1", jobsRouter);
app.use("/api/v1", usersRouter);
app.use("/api/v1", activityRouter);
app.use("/api/v1", reportsRouter);
app.use("/api/v1", timesheetsRouter);
app.use("/api/v1", spendingRouter);
app.use("/api/v1", confirmationsRouter);
app.use("/api/v1", systemRouter);
app.use("/api/v1", meRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err && typeof err === "object" && "code" in err) {
    // Postgres invalid-text-representation (e.g. a malformed UUID in a path param)
    if (err.code === "22P02") {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }
    // Postgres foreign_key_violation (e.g. a vendor_id/requester_id that doesn't exist)
    if (err.code === "23503") {
      res.status(400).json({ error: "References a record that doesn't exist" });
      return;
    }
    // Postgres unique_violation (e.g. a phone/qr_tag_id that's already registered)
    if (err.code === "23505") {
      res.status(409).json({ error: "A record with that unique value already exists" });
      return;
    }
    // Postgres check_violation (e.g. a negative amount/rate) -- app-level
    // validation should catch this first, but the DB constraint is the
    // backstop, so it still needs a clean 400 rather than a raw 500.
    if (err.code === "23514") {
      res.status(400).json({ error: "Value violates a database constraint" });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`fieldops-backend listening on :${port}`);
});

const alertsCheckIntervalMs = Number(process.env.ALERTS_CHECK_INTERVAL_MS ?? 5 * 60 * 1000);
startExceptionsWorker(alertsCheckIntervalMs);
