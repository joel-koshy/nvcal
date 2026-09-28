-- Tasks are standalone progress-tracking entities within a calendar.

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,

    status TEXT NOT NULL DEFAULT 'pending',
    target_steps INTEGER NOT NULL DEFAULT 1,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,

    version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_calendar_id
    ON tasks(calendar_id);
