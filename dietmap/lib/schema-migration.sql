-- Run this migration against your existing database
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS dietary_safety JSONB NOT NULL DEFAULT '[]';
