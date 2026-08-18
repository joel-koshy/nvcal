DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS calendars;
DROP TABLE IF EXISTS oauth_connections;
DROP TABLE IF EXISTS users;

-- ==========================================
-- 1. USERS & OAUTH CONNECTIONS
-- ==========================================
CREATE TABLE users (
    id TEXT PRIMARY KEY,           -- UUID or NanoID
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,            -- Nullable if using OAuth only
    created_at TEXT NOT NULL
);

-- Stores the long-lived refresh tokens for Google/Apple Calendar syncing
CREATE TABLE oauth_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,        -- 'google', 'apple'
    provider_account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT NOT NULL,
    UNIQUE(user_id, provider)
);

-- ==========================================
-- 2. CALENDARS
-- ==========================================
CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color_hex TEXT DEFAULT '#FFFFFF',
    timezone TEXT NOT NULL DEFAULT 'UTC',

    -- External Integration Sync Metadata
    is_external INTEGER DEFAULT 0,          -- 0 or 1
    external_provider TEXT,                 -- e.g., 'google'
    external_calendar_id TEXT UNIQUE,       -- The ID from Google/Apple

    sync_token TEXT,                        -- Used to fetch only changes from external APIs
    sync_channel_id TEXT,            				-- NVCAL's UUID for the webhook channel watching this calendar -- Should be made an index??? AND UNIQUE
    sync_resource_id TEXT,

    version INTEGER NOT NULL DEFAULT 1      -- OCC Versioning
);

-- ==========================================
-- 3. TASKS
-- ==========================================
-- Tasks are standalone entities. They track progress.
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,

    -- Progress Tracking (e.g., 1 out of 3 steps completed)
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
    target_steps INTEGER DEFAULT 1,
    completed_steps INTEGER DEFAULT 0,

    due_date TEXT,                          -- Optional overarching deadline

    version INTEGER NOT NULL DEFAULT 1      -- OCC Versioning
);

-- ==========================================
-- 4. EVENTS
-- ==========================================
-- Events block off time. They can optionally belong to a Task.
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, -- Link to Task

    title TEXT NOT NULL,
    description TEXT,

    -- Time bounds
    start_time TEXT NOT NULL, -- ISO-8601 UTC
    end_time TEXT NOT NULL,   -- ISO-8601 UTC
    is_all_day INTEGER DEFAULT 0,

    -- Recurrence Standard (RFC 5545)
    rrule TEXT,               -- e.g., 'FREQ=WEEKLY;BYDAY=MO,WE,FR'

    -- External Integration Link
    external_event_id TEXT UNIQUE,   -- Maps to Google/Apple event ID
		external_provider TEXT,

    version INTEGER NOT NULL DEFAULT 1      -- OCC Versioning
);

-- Indexes for performance on Edge Reads
CREATE INDEX idx_events_calendar_time ON events(calendar_id, start_time);
CREATE INDEX idx_tasks_calendar ON tasks(calendar_id);
CREATE INDEX idx_oauth_user ON oauth_connections(user_id);
