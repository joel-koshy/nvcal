import { z } from "zod";
import { CalendarSchema } from "../../entities/calendar";

/** GET /api/calendars */
export const CalendarListResponseSchema = z.object({
  calendars: z.array(CalendarSchema),
});
export type CalendarListResponse = z.output<typeof CalendarListResponseSchema>;

/** POST /api/calendars · PUT /api/calendars/:id (success) */
export const CalendarResponseSchema = z.object({
  calendar: CalendarSchema,
});
export type CalendarResponse = z.output<typeof CalendarResponseSchema>;

/** PUT/DELETE /api/calendars/:id — optimistic-concurrency conflict body. */
export const CalendarConflictResponseSchema = z.object({
  error: z.literal("Conflict"),
  currentState: CalendarSchema,
});
export type CalendarConflictResponse = z.output<typeof CalendarConflictResponseSchema>;
