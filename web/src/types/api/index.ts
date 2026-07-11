export type { EventRoute } from './events';
export type { AuthRoute } from './auth';
export type { Credentials, AuthSuccess } from './auth';
export type {
  TimeWindow,
  CreateEventRequest,
  UpdateEventRequest,
  GetEventsResponse,
  CreateEventResponse,
  UpdateEventResponse,
  ConflictResponse,
} from './events';

import type { EventRoute } from './events';
import type { AuthRoute } from './auth';

// ─── Shared Primitives ───────────────────────────────────────────────────────

/** Backend error envelope. */
export interface ApiError {
  error: string;
  issues?: string[];
}

// ─── Unified Route Map ──────────────────────────────────────────────────────

/**
 * Exhaustive mapping of every API route to its return type.
 * Use with `api<T>(path)` for compile-time safety.
 *
 * Example:
 *   const res = await api<ApiRoute['/api/events GET']>('/api/events?…');
 */
export interface ApiRoute extends EventRoute, AuthRoute {}

/** Infer response type from a route key. */
export type ApiResponse<R extends keyof ApiRoute> = ApiRoute[R];
