-- D1 Database Schema for Zero-Cost Currency Conversion Platform

CREATE TABLE IF NOT EXISTS rates_cache (
    base_currency TEXT PRIMARY KEY,
    rates_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    country TEXT,
    first_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    amount REAL,
    timestamp INTEGER NOT NULL
);

-- Index for analytics fast queries
CREATE INDEX IF NOT EXISTS idx_conversions_timestamp ON conversions(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
