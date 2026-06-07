import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

const DATABASE_URL = process.env.DATABASE_URL || "";
const PGSSLMODE = process.env.PGSSLMODE || "";

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
}) : null;

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT app_state_singleton CHECK (id = 1)
    );
  `);

  await pool.query(`
    INSERT INTO app_state (id, data)
    VALUES (1, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    if (pool) {
      await pool.query("SELECT 1");
    }
    res.json({
      ok: true,
      db: pool ? "online" : "not_configured",
      now: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      db: "error",
      message: err.message,
      now: new Date().toISOString()
    });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        data: null,
        version: null,
        db: "not_configured"
      });
    }

    await initDb();
    const result = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 1");
    const row = result.rows[0] || { data: null, updated_at: null };

    res.json({
      ok: true,
      data: row.data,
      version: row.updated_at,
      db: "online"
    });
  } catch (err) {
    console.error("GET /api/data failed:", err);
    res.status(500).json({
      ok: false,
      error: "DATA_LOAD_FAILED",
      message: err.message
    });
  }
});

app.post("/api/save", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        ok: false,
        error: "DB_NOT_CONFIGURED",
        message: "DATABASE_URL is not configured."
      });
    }

    await initDb();

    const incoming = req.body || {};
    const data = incoming.data && typeof incoming.data === "object"
      ? incoming.data
      : incoming;

    if (!data || typeof data !== "object") {
      return res.status(400).json({
        ok: false,
        error: "INVALID_DATA",
        message: "Request body must be a JSON object."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO app_state (id, data, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      RETURNING updated_at;
      `,
      [JSON.stringify(data)]
    );

    res.json({
      ok: true,
      version: result.rows[0].updated_at,
      db: "online"
    });
  } catch (err) {
    console.error("POST /api/save failed:", err);
    res.status(500).json({
      ok: false,
      error: "SAVE_FAILED",
      message: err.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Contract Management System running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
