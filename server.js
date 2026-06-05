import express from "express";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it in Railway Variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: "0"
}));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      reason TEXT,
      CONSTRAINT one_row CHECK (id = 1)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      audit_id BIGSERIAL PRIMARY KEY,
      reason TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO system_state (id, data, reason)
    VALUES (1, '{}'::jsonb, 'initial')
    ON CONFLICT (id) DO NOTHING;
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, db: "online", now: r.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "DB_ERROR" });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const r = await pool.query("SELECT data, updated_at, reason FROM system_state WHERE id=1");
    const row = r.rows[0] || { data: null };
    res.json({
      ok: true,
      data: row.data,
      updated_at: row.updated_at,
      reason: row.reason
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "LOAD_FAILED" });
  }
});

app.post("/api/save", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
    }

    payload.updated_at = payload.updated_at || new Date().toISOString();

    await pool.query("BEGIN");

    await pool.query(
      `UPDATE system_state
       SET data=$1::jsonb, updated_at=NOW(), reason=$2, updated_by=$3
       WHERE id=1`,
      [JSON.stringify(payload), payload.reason || "", payload.updated_by || ""]
    );

    await pool.query(
      `INSERT INTO audit_log (reason, payload) VALUES ($1, $2::jsonb)`,
      [payload.reason || "save", JSON.stringify({
        version: payload.version,
        updated_at: payload.updated_at,
        reason: payload.reason || "",
        counts: {
          diwan: Array.isArray(payload.diwan) ? payload.diwan.length : 0,
          jahaat: Array.isArray(payload.jahaat) ? payload.jahaat.length : 0,
          audit: Array.isArray(payload.audit) ? payload.audit.length : 0
        }
      })]
    );

    await pool.query("COMMIT");

    res.json({ ok: true, saved_at: new Date().toISOString() });
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ ok: false, error: "SAVE_FAILED" });
  }
});

app.get("/api/export", async (req, res) => {
  try {
    const r = await pool.query("SELECT data FROM system_state WHERE id=1");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=contracts-system-backup.json");
    res.send(JSON.stringify(r.rows[0]?.data || {}, null, 2));
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "EXPORT_FAILED" });
  }
});

app.post("/api/import", async (req, res) => {
  try {
    const payload = req.body || {};
    await pool.query(
      `UPDATE system_state SET data=$1::jsonb, updated_at=NOW(), reason='manual import' WHERE id=1`,
      [JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "IMPORT_FAILED" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Contracts system running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
