import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Idempotent schema migrations — fire once at module load
pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS trip_name text').catch(() => {});
pool.query('ALTER TABLE scan_restaurants ADD COLUMN IF NOT EXISTS menu_photo_urls text[] DEFAULT \'{}\'').catch(() => {});
pool.query('ALTER TABLE lists ADD COLUMN IF NOT EXISTS scan_id UUID').catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS menu_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  detected_language TEXT,
  ai_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});
pool.query('ALTER TABLE menu_scans ADD COLUMN IF NOT EXISTS restaurant_name TEXT').catch(() => {});
pool.query('ALTER TABLE menu_scans ADD COLUMN IF NOT EXISTS cuisine_type TEXT').catch(() => {});
pool.query("ALTER TABLE menu_scans ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] DEFAULT '{}'").catch(() => {});
pool.query('ALTER TABLE lists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ').catch(() => {});
// Moderation
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','moderator'))").catch(() => {});
pool.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','flagged','removed'))").catch(() => {});
pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_verdict JSONB').catch(() => {});
pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0').catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  ai_action TEXT,
  ai_summary TEXT,
  ai_confidence INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
)`).catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS review_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
)`).catch(() => {});
pool.query('ALTER TABLE reviews ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0').catch(() => {});
pool.query('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS reference_id UUID').catch(() => {});
pool.query("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'complete'").catch(() => {});
pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'pending'").catch(() => {});
pool.query('CREATE UNIQUE INDEX IF NOT EXISTS reports_restaurant_user ON reports(restaurant_id, user_id)').catch(() => {});
pool.query('ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS ai_action TEXT').catch(() => {});
pool.query('ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS ai_summary TEXT').catch(() => {});
pool.query('ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS ai_confidence INT').catch(() => {});
pool.query('ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(() => {});
pool.query(`INSERT INTO feature_flags (key, enabled) VALUES ('seed_data', false) ON CONFLICT DO NOTHING`).catch(() => {});
pool.query('CREATE UNIQUE INDEX IF NOT EXISTS restaurant_dietary_tags_restaurant_tag ON restaurant_dietary_tags(restaurant_id, tag)').catch(() => {});

export default pool;

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}
