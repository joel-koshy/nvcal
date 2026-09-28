-- Core identities and provider credentials.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE oauth_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT NOT NULL,
    UNIQUE(user_id, provider)
);

CREATE INDEX idx_oauth_connections_user_id
    ON oauth_connections(user_id);
