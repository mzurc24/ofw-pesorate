CREATE TABLE IF NOT EXISTS social_events (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO social_events (id, platform, created_at) VALUES ('seed_fb_1', 'Facebook', 1711684800000);
INSERT OR IGNORE INTO social_events (id, platform, created_at) VALUES ('seed_wa_1', 'WhatsApp', 1711688400000);
INSERT OR IGNORE INTO social_events (id, platform, created_at) VALUES ('seed_tg_1', 'Telegram', 1711692000000);
