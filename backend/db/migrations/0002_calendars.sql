-- Calendars owned by users, including external synchronization metadata.

CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color_hex TEXT NOT NULL DEFAULT '#FFFFFF',
    timezone TEXT NOT NULL DEFAULT 'UTC',

    is_external INTEGER NOT NULL DEFAULT 0,
    external_provider TEXT,
    external_calendar_id TEXT UNIQUE,

    sync_token TEXT,
    sync_channel_id TEXT,
    sync_resource_id TEXT,

    version INTEGER NOT NULL DEFAULT 1
);
