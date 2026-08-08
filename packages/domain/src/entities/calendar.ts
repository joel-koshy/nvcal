import { z } from "zod";

/** Calendar entity — canonical single source of truth for API responses.
 * No user_id: ownership is server-side state resolved from the session (like EventSchema). */
export const CalendarSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color_hex: z.string().default("#FFFFFF"),
  timezone: z.string().default("UTC"),

  is_external: z.number().min(0).max(1).default(0),
  external_provider: z.string().nullable().default(null),
  external_calendar_id: z.string().nullable().default(null),
  sync_token: z.string().nullable().default(null),
  sync_channel_id: z.string().nullable().default(null),
  sync_resource_id: z.string().nullable().default(null),

  version: z.number().int().min(1),
});

/** Calendar as returned (defaults materialized). */
export type Calendar = z.output<typeof CalendarSchema>;
/** Full-entity input (defaulted fields may be omitted). */
export type CalendarFields = z.input<typeof CalendarSchema>;
