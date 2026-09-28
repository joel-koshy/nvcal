-- DESTRUCTIVE: local development/test reset only.
-- This intentionally removes application data and D1's migration history.

DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS calendars;
DROP TABLE IF EXISTS oauth_connections;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS d1_migrations;
