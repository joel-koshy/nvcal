import type { EventListResponse, EventResponse } from "@nvcal/domain";

/** Events API route → response type map. */
export interface EventRoute {
	'/api/events GET': EventListResponse;
	'/api/events POST': EventResponse;
	'/api/events PUT': EventResponse;
	'/api/events DELETE': void;
}