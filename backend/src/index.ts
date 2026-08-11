import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db/pool.js";
import { HttpError } from "./lib/httpError.js";
import { assetsRouter } from "./routes/assets.js";
import { checkoutsRouter } from "./routes/checkouts.js";
import { consumablesRouter } from "./routes/consumables.js";
import { loadoutsRouter } from "./routes/loadouts.js";
import { sitesRouter } from "./routes/sites.js";

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

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Postgres invalid-text-representation (e.g. a malformed UUID in a path param)
  if (err && typeof err === "object" && "code" in err && err.code === "22P02") {
    res.status(400).json({ error: "Invalid ID format" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`fieldops-backend listening on :${port}`);
});
