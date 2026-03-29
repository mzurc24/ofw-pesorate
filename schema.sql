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

-- api_logs: Track each Twelve Data API interaction
CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- settings: Key-value store for system config (e.g. last_fixer_fetch timestamp)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- api_usage: Track daily Twelve Data API usage (Cost Control)
CREATE TABLE IF NOT EXISTS api_usage (
    month TEXT PRIMARY KEY, -- YYYY-MM-DD
    fixer_calls INTEGER DEFAULT 0
);

-- Set initial usage for current month if not exists
INSERT OR IGNORE INTO api_usage (month, fixer_calls) VALUES (STRFTIME('%Y-%m', 'now'), 0);
INSERT OR IGNORE INTO api_usage (month, twelvedata_calls) VALUES (STRFTIME('%Y-%m', 'now'), 0);

-- health_logs: Track system health checks for monitoring
CREATE TABLE IF NOT EXISTS health_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    details TEXT,
    response_time_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics fast queries
CREATE INDEX IF NOT EXISTS idx_conversions_timestamp ON conversions(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON currency_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_cleanup_timestamp ON cleanup_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs(timestamp);

-- social_traffic: Tracking visits from Facebook, Instagram, etc.
CREATE TABLE IF NOT EXISTS social_traffic (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    country TEXT,
    device_type TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_traffic_platform ON social_traffic(platform);
CREATE INDEX IF NOT EXISTS idx_social_traffic_timestamp ON social_traffic(timestamp);
CREATE INDEX IF NOT EXISTS idx_social_traffic_status ON social_traffic(status);

-- healing_logs: Tracking automated and manual self-healing events
CREATE TABLE IF NOT EXISTS healing_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    platform TEXT,
    status TEXT NOT NULL,
    details TEXT,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_healing_logs_timestamp ON healing_logs(timestamp);

-- devops_audit: Track hourly health checks and automated decisions
CREATE TABLE IF NOT EXISTS devops_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL, -- HEALTHY, DEGRADED, DOWN
    findings_json TEXT, -- Aggregated analysis results
    actions_taken TEXT, -- Maintenance tasks executed
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_devops_audit_timestamp ON devops_audit(timestamp);

-- alert_subscriptions: Track user-defined rate thresholds and webhooks
CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    target_currency TEXT NOT NULL,
    threshold REAL NOT NULL,
    direction TEXT NOT NULL, -- 'above' or 'below'
    webhook_url TEXT NOT NULL,
    last_triggered INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_user ON alert_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_status ON alert_subscriptions(status);

-- user_preferences: Store long-term currency and locale preferences per user
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    preferred_currency TEXT NOT NULL,
    home_currency TEXT,
    updated_at INTEGER NOT NULL
);


