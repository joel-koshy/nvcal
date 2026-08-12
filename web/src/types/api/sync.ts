import type { GoogleCalendarListResponse } from "@nvcal/domain";

/** Google sync API route → response type map. */
export interface SyncRoute {
	'/api/sync/google/calendars GET': GoogleCalendarListResponse;
	'/api/sync/google/import POST': void;
}