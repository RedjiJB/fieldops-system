import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db/pool.js";
import { HttpError } from "./lib/httpError.js";
import { alertsRouter } from "./routes/alerts.js";
import { assetsRouter } from "./routes/assets.js";
import { checkoutsRouter } from "./routes/checkouts.js";
import { consumablesRouter } from "./routes/consumables.js";
import { crewMembersRouter } from "./routes/crewMembers.js";
import { documentsRouter } from "./routes/documents.js";
import { loadoutsRouter } from "./routes/loadouts.js";
import { ordersRouter } from "./routes/orders.js";
import { shiftsRouter } from "./routes/shifts.js";
import { sitesRouter } from "./routes/sites.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { vendorsRouter } from "./routes/vendors.js";
import { startExceptionsWorker } from "./workers/exceptions.js";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

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
app.use("/api/v1", crewMembersRouter);

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
