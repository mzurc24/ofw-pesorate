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

CREATE TABLE IF NOT EXISTS currency_snapshots (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE NOT NULL,
    snapshot_json TEXT NOT NULL,
    source TEXT,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cleanup_logs (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    rows_deleted INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    details TEXT
);

-- api_logs: Track each Fixer.io API interaction
CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics fast queries
CREATE INDEX IF NOT EXISTS idx_conversions_timestamp ON conversions(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON currency_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_cleanup_timestamp ON cleanup_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs(timestamp);
