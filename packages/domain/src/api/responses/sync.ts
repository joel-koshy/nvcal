import { z } from "zod";

/** A discoverable Google calendar. */
export const GoogleCalendarItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
});
export type GoogleCalendarItem = z.output<typeof GoogleCalendarItemSchema>;

/** GET /api/sync/google/calendars */
export const GoogleCalendarListResponseSchema = z.object({
  calendars: z.array(GoogleCalendarItemSchema),
});
export type GoogleCalendarListResponse = z.output<typeof GoogleCalendarListResponseSchema>;
