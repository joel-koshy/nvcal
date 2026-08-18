import { z } from "zod";

/** Event entity — canonical shape for API responses and DB rows. */
export const EventSchema = z.object({
	id: z.string(),
	calendar_id: z.coerce.string(),
	task_id: z.string().nullable().default(null),
	title: z.string().min(1),
	description: z.string().nullable().default(null),
	start_time: z.iso.datetime({ message: "Invalid Date Time Format" }),
	end_time: z.iso.datetime({ message: "Invalid Date Time Format" }),
	is_all_day: z.number().min(0).max(1).default(0),
	rrule: z.string().nullable().default(null),
	external_event_id: z.string().nullable().default(null),
	version: z.number().int().min(1),
});

/** Event as returned (defaults materialized). */
export type Event = z.output<typeof EventSchema>;
/** Full-entity input (defaulted fields may be omitted). */
export type EventFields = z.input<typeof EventSchema>;