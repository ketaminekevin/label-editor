-- ── Visibility columns on restaurants ────────────────────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS discovered_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_restaurants_visibility ON restaurants(visibility);
CREATE INDEX IF NOT EXISTS idx_restaurants_discovered_by ON restaurants(discovered_by);

-- ── Scans table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  country TEXT,
  dietary_tags TEXT[] NOT NULL DEFAULT '{}',
  travel_dates_start DATE,
  travel_dates_end DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result_summary TEXT,
  phrase_cards JSONB DEFAULT '[]',
  safe_dishes JSONB DEFAULT '[]',
  danger_foods JSONB DEFAULT '[]',
  cuisine_notes TEXT,
  coverage_confidence TEXT,
  coverage_note TEXT,
  error_message TEXT,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);

-- ── Scan ↔ restaurant join ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_restaurants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  ai_notes TEXT,
  ai_safety_confidence TEXT CHECK (ai_safety_confidence IN ('high', 'medium', 'low')),
  recommended_dishes TEXT[],
  warnings TEXT[],
  source_urls TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scan_id, restaurant_id)
);

-- ── User tier / billing ───────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_tier TEXT NOT NULL DEFAULT 'free' CHECK (account_tier IN ('free', 'pro'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS scans_remaining INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- ── Auto-publish trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION publish_reviewed_restaurant()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE restaurants
  SET visibility = 'public'
  WHERE id = NEW.restaurant_id AND visibility = 'private';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_publish_on_review ON reviews;
CREATE TRIGGER trigger_publish_on_review
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION publish_reviewed_restaurant();
