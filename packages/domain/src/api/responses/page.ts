import { z } from "zod";
import { EventSchema } from "../../entities/event";
import { CalendarSchema } from "../../entities/calendar";

/**
 * The full client bootstrap: embedded as <script id="initial-state"> by the
 * page route so the SPA hydrates without any network round-trips. Parsing
 * strips ownership columns (user_id) and materializes entity defaults,
 * exactly like every other @nvcal/domain response contract.
 */
export const PageStateSchema = z.object({
	events: z.array(EventSchema),
	calendars: z.array(CalendarSchema),
	authenticated: z.boolean(),
	user: z.object({ id: z.string() }).nullable(),
});
export type PageState = z.output<typeof PageStateSchema>;