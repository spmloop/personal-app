"use strict";
const express = require("express");
const cors    = require("cors");
const fs      = require("fs").promises;
const path    = require("path");

const PORT     = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const FRONTEND = path.join(__dirname, "../frontend");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ── key-value helpers ──────────────────────────────────────────── */
// encode key → safe filename using base64url (no slashes, no colons)
const toFile   = k => path.join(DATA_DIR, Buffer.from(k).toString("base64url") + ".json");
const fromFile = f => Buffer.from(path.basename(f, ".json"), "base64url").toString();

/* ── health check ───────────────────────────────────────────────── */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ── GET /api/kv?k=<key>  →  { value: string | null } ─────────── */
app.get("/api/kv", async (req, res) => {
  const k = req.query.k;
  if (!k) return res.status(400).json({ error: "missing k" });
  try {
    const raw = await fs.readFile(toFile(k), "utf8");
    res.json({ value: raw });
  } catch {
    res.json({ value: null });
  }
});

/* ── PUT /api/kv?k=<key>  body: { value: string } ──────────────── */
app.put("/api/kv", async (req, res) => {
  const k = req.query.k;
  if (!k) return res.status(400).json({ error: "missing k" });
  const v = req.body.value;
  if (typeof v !== "string") return res.status(400).json({ error: "value must be string" });
  await fs.writeFile(toFile(k), v, "utf8");
  res.json({ ok: true });
});

/* ── DELETE /api/kv?k=<key> ─────────────────────────────────────── */
app.delete("/api/kv", async (req, res) => {
  const k = req.query.k;
  if (!k) return res.status(400).json({ error: "missing k" });
  try { await fs.unlink(toFile(k)); } catch { /* already gone */ }
  res.json({ ok: true });
});

/* ── GET /api/kv/keys?prefix=<prefix>  →  { keys: string[] } ───── */
app.get("/api/kv/keys", async (req, res) => {
  const prefix = req.query.prefix || "";
  try {
    const files = await fs.readdir(DATA_DIR);
    const keys = files
      .filter(f => f.endsWith(".json"))
      .map(fromFile)
      .filter(k => k.startsWith(prefix));
    res.json({ keys });
  } catch {
    res.json({ keys: [] });
  }
});

/* ── serve frontend (optional, for self-hosted mode) ────────────── */
app.use(express.static(FRONTEND));
app.get("*", (_req, res) => res.sendFile(path.join(FRONTEND, "index.html")));

/* ── start ──────────────────────────────────────────────────────── */
async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  app.listen(PORT, () => {
    console.log(`Backend  →  http://localhost:${PORT}`);
    console.log(`Frontend →  http://localhost:${PORT}  (served as static files)`);
    console.log(`Data dir →  ${DATA_DIR}`);
  });
}
start();
