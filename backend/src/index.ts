import "dotenv/config";
import express from "express";
import { pool } from "./db/pool.js";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`fieldops-backend listening on :${port}`);
});
