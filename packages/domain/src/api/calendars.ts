import { z } from "zod";
import { CalendarSchema } from "../entities/calendar";

// Ownership (user_id) is never part of the request contract — it is
// derived from the session on the server, mirroring the events API.
export const CreateCalendarSchema = CalendarSchema.omit({
	id: true,
	version: true,
});

export const UpdateCalendarSchema = CalendarSchema.omit({ id: true });

/** Request types — what the client sends. */
export type CreateCalendarInput = z.input<typeof CreateCalendarSchema>;
export type UpdateCalendarInput = z.input<typeof UpdateCalendarSchema>;

/** Validated types the server works with. */
export type CreateCalendar = z.output<typeof CreateCalendarSchema>;
export type UpdateCalendar = z.output<typeof UpdateCalendarSchema>;
