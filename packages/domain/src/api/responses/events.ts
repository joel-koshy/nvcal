import { z } from "zod";
import { EventSchema } from "../../entities/event";

/** GET /api/events */
export const EventListResponseSchema = z.object({
	events: z.array(EventSchema),
});
export type EventListResponse = z.output<typeof EventListResponseSchema>;

/** POST /api/events · PUT /api/events/:id (success) */
export const EventResponseSchema = z.object({
	event: EventSchema,
});
export type EventResponse = z.output<typeof EventResponseSchema>;

/** PUT/DELETE /api/events/:id — optimistic-concurrency conflict body. */
export const EventConflictResponseSchema = z.object({
	error: z.literal("Conflict"),
	currentState: EventSchema,
});
export type EventConflictResponse = z.output<typeof EventConflictResponseSchema>;