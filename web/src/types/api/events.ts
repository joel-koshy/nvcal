import type { Event } from '@/types/events';

// ─── Query Params ───────────────────────────────────────────────────────────

/** GET /api/events — max 62-day window. */
export interface TimeWindow {
  start: string; // ISO-8601 datetime
  end: string;   // ISO-8601 datetime
}

// ─── Request Bodies ─────────────────────────────────────────────────────────

export interface CreateEventRequest {
  calendar_id: string;
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  is_all_day?: number;
  task_id?: string | null;
  rrule?: string | null;
  external_event_id?: string | null;
}

export interface UpdateEventRequest extends CreateEventRequest {
  version: number;
}

// ─── Response Bodies ────────────────────────────────────────────────────────

/** GET /api/events */
export interface GetEventsResponse {
  events: Event[];
}

/** POST /api/events */
export interface CreateEventResponse {
  event: Event;
}

/** PUT /api/events/:id */
export type UpdateEventResponse = CreateEventResponse;

/** DELETE /api/events/:id — 409 conflict body. */
export interface ConflictResponse {
  error: 'Conflict';
  currentState: Event;
}

// ─── Route → Type Map ───────────────────────────────────────────────────────

export interface EventRoute {
  '/api/events GET': GetEventsResponse;
  '/api/events POST': CreateEventResponse;
  '/api/events PUT': UpdateEventResponse;
  '/api/events DELETE': void;
}
