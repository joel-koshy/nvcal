# API Routes Documentation

This document covers the authentication, sync, webhook, and events API routes for the NVCal backend.

## Base URLs

| Route Prefix | Purpose | Auth Required |
|--------------|---------|---------------|
| `/auth`      | User authentication (signup/login/OAuth) | No |
| `/api/*`     | Events CRUD | Yes (JWT cookie) |
| `/sync/*`    | Calendar sync operations | Yes (JWT cookie) |
| `/webhooks/*`| External webhook receivers | No (verified by provider) |

---

## Authentication Routes (`/auth`)

### `POST /auth/signup`

Create a new user account. Returns a session cookie on success.

**Request Body:**
```json
{
  "email": "user@example.com",     // Required: Valid email format
  "password": "securePassword123"  // Required: Minimum 8 characters
}
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 201 | Success | `{ "success": true, "user_id": "uuid" }` |
| 400 | Validation error | `{ "error": "Email must be valid, Password must be at least 8 characters" }` |
| 409 | Email already exists | `{ "error": "Email already in use" }` |

**Cookie Set:** `nvcal_session` (httpOnly, secure, sameSite: Strict, maxAge: 30 days)

---

### `POST /auth/login`

Authenticate an existing user. Returns a session cookie on success.

**Request Body:**
```json
{
  "email": "user@example.com",     // Required: Valid email format
  "password": "securePassword123"  // Required: Minimum 8 characters
}
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 200 | Success | `{ "success": true, "user_id": "uuid" }` |
| 400 | Invalid payload | `{ "error": "Invalid Payload" }` |
| 401 | Invalid credentials | `{ "error": "Invalid Credentials" }` |

**Cookie Set:** `nvcal_session` (httpOnly, secure, sameSite: Strict, maxAge: 30 days)

---

### `GET /auth/google/login`

Initiates Google OAuth flow. Redirects the user to Google's consent screen for calendar access.

**Query Parameters:** None

**Redirect:** `302` to `https://accounts.google.com/o/oauth2/v2/auth` with:
- `scope`: `userinfo.email calendar`
- `access_type`: `offline` (requests refresh token)
- `prompt`: `consent` (forces consent screen)

---

### `GET /auth/google/callback`

Google OAuth callback endpoint. Exchanges the authorization code for tokens, creates/updates the user, and sets the session cookie.

**Query Parameters:**
```
code: string    // Required: Authorization code from Google
```

**Responses:**

| Status | Description |
|--------|-------------|
| 302 | Success — Redirects to `/` with session cookie set |
| 400 | Missing authorization code |
| 500 | Failed token exchange |

**Cookie Set:** `nvcal_session` (httpOnly, secure, sameSite: Strict, maxAge: 30 days)

**Side Effects:**
- Creates a new user and default `Primary` calendar if this is the user's first Google login
- Stores/updates OAuth tokens in `oauth_connections` table

---

## Sync Routes (`/sync/google`)

All sync routes require a valid JWT session cookie (`nvcal_session`).

### `GET /sync/google/calendars`

Fetches the list of Google Calendars accessible to the authenticated user. Used for calendar discovery before import.

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 200 | Success | `{ "calendars": Calendar[] }` |
| 500 | Google API error | `{ "error": "Failed to fetch Google calendars" }` |

**Calendar Object (response):**
```typescript
{
  id: string,         // Google Calendar ID
  name: string,       // Calendar summary/title
  description: string,
  color: string       // Background color hex
}
```

---

### `POST /sync/google/import`

Initiates import of one or more Google Calendars. Creates local calendar entries and queues background jobs to fetch events.

**Request Body:**
```json
{
  "googleCalendarIds": ["calendar-id-1", "calendar-id-2"]  // Required: Non-empty array
}
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 202 | Import queued | No body |

**Side Effects:**
- Creates calendar records in `calendars` table with `is_external = 1`
- Queues `IMPORT_CAL` jobs for each calendar
- After import completes, the queue automatically sets up webhook watches

---

## Webhook Routes (`/webhooks`)

### `POST /webhooks/google`

Receiver for Google Calendar push notifications. Google sends a `POST` to this endpoint whenever a watched calendar changes.

**Request Headers (from Google):**
```
x-goog-channel-id: string     // Our channel ID (sync_channel_id)
x-goog-resource-state: string // 'sync' for initial verification, 'exists' for changes
```

**Responses:**

| Status | Description |
|--------|-------------|
| 200 | Always returns OK (regardless of processing result) |

**Behavior:**
- If `resource-state: sync` — returns OK immediately (Google's initial channel verification)
- Otherwise — queues a `PROCESS_WEBHOOK` job with the channel ID

**Note:** This endpoint is **not** protected by JWT auth. Google must be able to reach it directly. Channel verification relies on the unique channel ID stored in the database.

---

## Events Routes (`/api/events`)

All events routes require a valid JWT session cookie (`nvcal_session`).

### `GET /api/events`

Fetch all events for the authenticated user within a time window.

**Query Parameters:**
```
start: 2024-01-01T00:00:00Z    // Required: ISO 8601 datetime
end: 2024-01-31T23:59:59Z      // Required: ISO 8601 datetime, must be after start
```

**Constraints:**
- Maximum time window: 62 days

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 200 | Success | `{ "events": Event[] }` |
| 400 | Time window too large | `{ "error": "Time window too large. Maximum allowed is 62 days." }` |
| 400 | Validation error | `{ "error": "...", "issues": [...] }` |
| 500 | Database error | `{ "error": "Database Error" }` |

**Event Object Schema (response):**
```typescript
{
  id: string,              // UUID
  calendar_id: string,     // UUID
  task_id: string | null,  // Linked task, if any
  title: string,
  description: string | null,
  start_time: string,      // ISO 8601 datetime
  end_time: string,        // ISO 8601 datetime
  is_all_day: number,      // 0 or 1
  rrule: string | null,    // RFC 5545 recurrence rule
  external_event_id: string | null,  // Google/Apple event ID
  version: number          // For optimistic locking
}
```

---

### `POST /api/events`

Create a new event in a calendar owned by the authenticated user.

**Request Body:**
```json
{
  "calendar_id": "uuid",           // Required: Must be a calendar owned by the user
  "title": "Meeting",              // Required: Non-empty string
  "description": "Team sync",      // Optional: Defaults to null
  "start_time": "2024-01-15T09:00:00Z",  // Required: ISO 8601 datetime
  "end_time": "2024-01-15T10:00:00Z",    // Required: ISO 8601 datetime, must be after start_time
  "is_all_day": 0,                 // Optional: 0 or 1, defaults to 0
  "task_id": null,                 // Optional: Link to a task
  "rrule": null,                   // Optional: RFC 5545 recurrence rule
  "external_event_id": null        // Optional: External provider event ID
}
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 201 | Success (local calendar) | `{ "event": Event }` |
| 202 | Success (external calendar, export queued) | `{ "event": Event }` |
| 400 | Validation error | `{ "error": "...", "issues": [...] }` |
| 404 | Calendar not found | `{ "error": "Calendar not Found" }` |
| 500 | Database error | `{ "error": "Database Error" }` |

---

### `PUT /api/events/:id`

Update an existing event. Uses optimistic locking via the `version` field.

**Path Parameters:**
```
id: string    // Event UUID
```

**Request Body:**
```json
{
  "calendar_id": "uuid",           // Required: Must be a calendar owned by the user
  "title": "Updated Meeting",      // Required: Non-empty string
  "description": "Updated description",  // Optional
  "start_time": "2024-01-15T11:00:00Z",  // Required: ISO 8601 datetime
  "end_time": "2024-01-15T12:00:00Z",    // Required: ISO 8601 datetime, must be after start_time
  "is_all_day": 0,                 // Optional: 0 or 1
  "task_id": null,                 // Optional: Link to a task
  "rrule": null,                   // Optional: RFC 5545 recurrence rule
  "external_event_id": null,       // Optional: External provider event ID
  "version": 1                     // Required: Must match current version for optimistic locking
}
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 200 | Success (local calendar) | `{ "event": Event }` |
| 202 | Success (external calendar, export queued) | `{ "updatedEvent": Event }` |
| 400 | Validation error | `{ "error": "...", "issues": [...] }` |
| 404 | Calendar not found | `{ "error": "Calendar not Found" }` |
| 404 | Event not found | `{ "error": "Event not found" }` |
| 409 | Version conflict | `{ "error": "Conflict", "currentState": Event }` |

---

### `DELETE /api/events/:id`

Delete an existing event. Uses optimistic locking via the `version` query parameter.

**Path Parameters:**
```
id: string    // Event UUID
```

**Query Parameters:**
```
version: number    // Required: Must match current version (minimum: 1)
```

**Responses:**

| Status | Description | Response Body |
|--------|-------------|---------------|
| 204 | Success | No body |
| 404 | Event not found | `{ "error": "Event not found" }` |
| 409 | Version conflict | `{ "error": "Conflict", "currentState": Event }` |

---

## Background Worker (Queue)

The backend uses a Cloudflare Queue (`nvcal-sync-queue`) to process long-running sync operations asynchronously. The queue consumer is defined in `src/index.ts` and dispatches to handlers in `src/queue/`.

### Queue Configuration

```jsonc
// wrangler.jsonc
{
  "queues": {
    "producers": [{ "binding": "SYNC_QUEUE", "queue": "nvcal-sync-queue" }],
    "consumers": [{
      "queue": "nvcal-sync-queue",
      "max_batch_size": 10,     // Process up to 10 jobs together
      "max_batch_timeout": 5,   // Wait up to 5s to fill batch
      "max_retries": 3          // Retry up to 3x on failure
    }]
  }
}
```

### Job Types

All jobs follow a discriminated union type (`Job`) with an `action` field and a typed `payload`.

#### `IMPORT_CAL`

Bulk-imports events from an external Google Calendar into the local database.

**Payload:**
```typescript
{
  userId: string
  localCalendarId: string      // UUID of the local calendar record
  externalCalendarId: string   // Google Calendar ID
  provider: Providers.GOOGLE
  pageToken?: string           // For paginated results
}
```

**Flow:**
1. Fetches events from Google Calendar API (`timeMin` = 30 days ago, `timeMax` = now)
2. Upserts events into `events` table (only updates if data actually changed)
3. If `nextPageToken` is present — re-queues with the token to fetch next page
4. If `nextSyncToken` is present — stores it in `calendars.sync_token` and queues `SETUP_WEBHOOK_WATCH`
5. If neither token is returned — throws a fatal error

---

#### `SETUP_WEBHOOK_WATCH`

Registers a Google Calendar push notification webhook after initial import.

**Payload:**
```typescript
{
  userId: string
  provider: Providers.GOOGLE
  calendarId: string           // Local calendar ID
}
```

**Flow:**
1. Generates a unique `sync_channel_id` (UUID)
2. Calls Google Calendar API `events/watch` to register a webhook
3. Stores Google's `resourceId` and the channel ID in the `calendars` table

---

#### `PROCESS_WEBHOOK`

Handles incoming Google Calendar change notifications and syncs deltas.

**Payload:**
```typescript
{
  provider: Providers.GOOGLE
  channelId: string            // The sync_channel_id from the webhook
}
```

**Flow:**
1. Looks up the calendar by `sync_channel_id`
2. Fetches changes from Google using the stored `sync_token`
3. If `410 Gone` — token expired; clears token and re-queues a full `IMPORT_CAL`
4. Applies changes (upserts/updates) to local `events` table
5. Stores the new `nextSyncToken` for the next webhook

---

#### `EXPORT_EVENT`

Pushes local event changes (create/update/delete) to Google Calendar.

**Payload:**
```typescript
{
  userId: string
  externalCalendarId: string   // Google Calendar ID
  provider: Providers.GOOGLE
  action: 'POST' | 'PUT' | 'DELETE'
  eventId?: string             // Local event ID (for POST/PUT)
  externalEventId?: string     // Google event ID (for DELETE)
}
```

**Flow by action:**

| Action | Method | Description |
|--------|--------|-------------|
| `POST` | `POST` to `/calendars/{id}/events` | Creates event on Google, stores returned `external_event_id` |
| `PUT` | `PATCH` to `/calendars/{id}/events/{eventId}` | Updates existing Google event |
| `DELETE` | `DELETE` to `/calendars/{id}/events/{eventId}` | Removes event from Google |

---

### Queue Architecture Diagram

```
┌──────────────────────┐       ┌──────────────────────┐
│    Hono API Routes   │       │   Cloudflare Queue    │
│                      │       │  (nvcal-sync-queue)   │
│  POST /api/events    │──┐    │                       │
│  PUT  /api/events/:id│──┤    │  ┌─────────────────┐  │
│  DELETE /api/events  │──┼───>│  │  Batch Consumer  │  │
│                      │  │    │  │  (max 10, 5s)    │  │
│  POST /sync/google/  │──┤    │  └────────┬────────┘  │
│    import            │  │    │           │           │
└──────────────────────┘  │    └───────────┼───────────┘
                          │                │
                          │    ┌───────────▼───────────┐
                          │    │    queueHandler()     │
                          │    │    (src/queue/)       │
                          │    │                       │
                          │    │  IMPORT_CAL           │
                          │    │  SETUP_WEBHOOK_WATCH  │
                          │    │  PROCESS_WEBHOOK      │
                          │    │  EXPORT_EVENT         │
                          │    └───────────────────────┘
```

---

## Shared Schemas

### TimeWindowSchema (Query Parameters)
```typescript
{
  start: string    // ISO 8601 datetime
  end: string      // ISO 8601 datetime, must be after start
}
```

### CreateEventSchema (Request Body)
```typescript
{
  calendar_id: string,          // Required
  title: string,                // Required: Non-empty
  description: string | null,   // Optional: Defaults to null
  start_time: string,           // Required: ISO 8601 datetime
  end_time: string,             // Required: ISO 8601 datetime, must be after start_time
  is_all_day: number,           // Optional: 0 or 1, defaults to 0
  task_id: string | null,       // Optional: Link to a task
  rrule: string | null,         // Optional: RFC 5545 recurrence rule
  external_event_id: string | null  // Optional: External provider event ID
}
```

### UpdateEventSchema (Request Body)
```typescript
{
  calendar_id: string,          // Required
  title: string,                // Required: Non-empty
  description: string | null,   // Optional
  start_time: string,           // Required: ISO 8601 datetime
  end_time: string,             // Required: ISO 8601 datetime, must be after start_time
  is_all_day: number,           // Optional: 0 or 1
  task_id: string | null,       // Optional: Link to a task
  rrule: string | null,         // Optional: RFC 5545 recurrence rule
  external_event_id: string | null,  // Optional: External provider event ID
  version: number               // Required: For optimistic locking
}
```

### CredentialsSchema (Auth Request Body)
```typescript
{
  email: string,           // Required: Valid email format
  password: string         // Required: Minimum 8 characters
}
```

---

## Error Response Format

All error responses follow a consistent format:

```json
{
  "error": "Error message string"
}
```

Some validation errors include additional `issues` array with detailed error messages.

---

## Authentication

- **Method:** JWT stored in `nvcal_session` cookie
- **Algorithm:** HS256
- **Cookie Settings:** httpOnly, secure, sameSite: Strict, path: /
- **Token Expiry:** 30 days

All `/api/*` routes require a valid JWT token. The user ID is extracted from the token's `sub` claim and stored in the request context as `userId`.
