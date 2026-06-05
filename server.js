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
app.use(express.json({ limit: "120mb" }));

app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: "0",
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  }
}));

function sanitizeForJsonb(value) {
  if (typeof value === "string") return value.replace(/\u0000/g, "");
  if (Array.isArray(value)) return value.map(sanitizeForJsonb);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[String(k).replace(/\u0000/g, "")] = sanitizeForJsonb(v);
    }
    return out;
  }
  return value;
}

function payloadSizeMB(payload) {
  try {
    return (Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024 / 1024).toFixed(2);
  } catch {
    return "unknown";
  }
}

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
    INSERT INTO system_state (id, data, reason)
    VALUES (1, '{}'::jsonb, 'initial')
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS save_log (
      log_id BIGSERIAL PRIMARY KEY,
      reason TEXT,
      summary JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, db: "online", now: r.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: "DB_ERROR", message: err.message });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const r = await pool.query("SELECT data, updated_at, reason FROM system_state WHERE id=1");
    const row = r.rows[0] || { data: null };
    res.json({ ok: true, data: row.data, updated_at: row.updated_at, reason: row.reason });
  } catch (err) {
    res.status(500).json({ ok: false, error: "LOAD_FAILED", message: err.message });
  }
});

app.post("/api/save", async (req, res) => {
  const client = await pool.connect();
  try {
    let payload = req.body || {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
    }

    payload = sanitizeForJsonb(payload);
    payload.version = payload.version || 1;
    payload.updated_at = payload.updated_at || new Date().toISOString();
    const size = payloadSizeMB(payload);

    await client.query("BEGIN");

    await client.query(
      `UPDATE system_state
       SET data=$1::jsonb, updated_at=NOW(), reason=$2, updated_by=$3
       WHERE id=1`,
      [JSON.stringify(payload), payload.reason || "", payload.updated_by || ""]
    );

    // سجل اختياري لا يوقف الحفظ لو حصل خطأ.
    try {
      await client.query(
        `INSERT INTO save_log (reason, summary)
         VALUES ($1, $2::jsonb)`,
        [payload.reason || "save", JSON.stringify({
          version: payload.version,
          updated_at: payload.updated_at,
          reason: payload.reason || "",
          payloadSizeMB: size,
          counts: {
            diwan: Array.isArray(payload.diwan) ? payload.diwan.length : 0,
            jahaat: Array.isArray(payload.jahaat) ? payload.jahaat.length : 0,
            audit: Array.isArray(payload.audit) ? payload.audit.length : 0,
            docsKeys: payload.docs && typeof payload.docs === "object" ? Object.keys(payload.docs).length : 0
          }
        })]
      );
    } catch (logErr) {
      console.warn("Optional save_log insert skipped:", logErr.message);
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      saved_at: new Date().toISOString(),
      payloadSizeMB: size,
      counts: {
        diwan: Array.isArray(payload.diwan) ? payload.diwan.length : 0,
        jahaat: Array.isArray(payload.jahaat) ? payload.jahaat.length : 0
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("SAVE ERROR:", err);
    res.status(500).json({
      ok: false,
      error: "SAVE_FAILED",
      message: err.message,
      code: err.code || null,
      detail: err.detail || null,
      hint: err.hint || null
    });
  } finally {
    client.release();
  }
});

app.get("/api/export", async (req, res) => {
  try {
    const r = await pool.query("SELECT data FROM system_state WHERE id=1");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=contracts-system-backup.json");
    res.send(JSON.stringify(r.rows[0]?.data || {}, null, 2));
  } catch (err) {
    res.status(500).json({ ok: false, error: "EXPORT_FAILED", message: err.message });
  }
});

app.post("/api/import", async (req, res) => {
  try {
    const payload = sanitizeForJsonb(req.body || {});
    await pool.query(
      `UPDATE system_state SET data=$1::jsonb, updated_at=NOW(), reason='manual import' WHERE id=1`,
      [JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "IMPORT_FAILED", message: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Contracts system running on port ${PORT}`));
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
