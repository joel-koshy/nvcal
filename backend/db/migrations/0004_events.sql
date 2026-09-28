-- Events block off time and may optionally be linked to a task.

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,

    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_all_day INTEGER NOT NULL DEFAULT 0,
    rrule TEXT,

    external_event_id TEXT UNIQUE,
    external_provider TEXT,

    version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_events_calendar_time
    ON events(calendar_id, start_time);
