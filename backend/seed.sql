-- backend/seed.sql

-- 1. Create the User
-- Email: demo@example.com
-- Password: demo1234
INSERT INTO users (id, email, password_hash, created_at)
VALUES ('usr_001', 'demo@example.com', 'b7a9e99065ec8a6708b866e3f854854f:8be57483946e30f65506a3e763adcb867651d3a19f6e30d83ee69c35ac97b5de', '2026-05-19T12:00:00Z');

-- 2. Create the Calendar
INSERT INTO calendars (id, user_id, name, color_hex, timezone)
VALUES ('cal_001', 'usr_001', 'NVCAL Primary', '#00FF00', 'America/New_York');

-- 3. Create a Task (e.g., Building the App)
INSERT INTO tasks (id, calendar_id, title, description, status, target_steps, completed_steps, due_date)
VALUES ('tsk_001', 'cal_001', 'Build NVCAL MVP', 'Complete the 14.6KB single-packet calendar', 'in_progress', 3, 1, '2026-06-01T00:00:00Z');

-- 4. Create Events (Linked to the Calendar and the Task)
-- Event A: Completed Step
INSERT INTO events (id, calendar_id, task_id, title, description, start_time, end_time)
VALUES ('evt_001', 'cal_001', 'tsk_001', 'Architect D1 Schema', 'Drafting the OCC schema', '2026-06-02T14:00:00Z', '2026-06-02T16:00:00Z');

-- Event B: Upcoming Step
INSERT INTO events (id, calendar_id, task_id, title, description, start_time, end_time)
VALUES ('evt_002', 'cal_001', 'tsk_001', 'Wire up Preact UI', 'Dump raw JSON to screen', '2026-05-20T10:00:00Z', '2026-05-20T12:00:00Z');
