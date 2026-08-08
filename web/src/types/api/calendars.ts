import type {
	CalendarListResponse,
	CalendarResponse,
	CalendarConflictResponse,
} from "@nvcal/domain";

/** Calendar API route → response type map. */
export interface CalendarRoute {
	'/api/calendars GET': CalendarListResponse;
	'/api/calendars POST': CalendarResponse;
	'/api/calendars PUT': CalendarResponse;
	'/api/calendars DELETE': void;
	'/api/calendars CONFLICT': CalendarConflictResponse;
}