-- OFW Pesorate Analytics Unification & Indexing
-- Executed via Wrangler D1 CLI

-- 1. Index users table for 'New Users 7d' and 'Country Analytics'
CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);

-- 2. Index conversions table for 'Total Conversions 7d' and 'Trend Timeline'
CREATE INDEX IF NOT EXISTS idx_conversions_timestamp ON conversions(timestamp);
CREATE INDEX IF NOT EXISTS idx_conversions_user_id ON conversions(user_id);

-- 3. Social Traffic Unification
-- We abandon 'social_events' and fully index 'social_traffic'
CREATE INDEX IF NOT EXISTS idx_social_traffic_timestamp ON social_traffic(timestamp);
CREATE INDEX IF NOT EXISTS idx_social_traffic_platform_status ON social_traffic(platform, status);

-- Prepare the legacy table for cleanup (we don't delete to be safe, but rename if needed, but for now we leave it)
-- This migration standardizes all future requests around social_traffic.
