import { z } from "zod";

/** POST /api/sync/google/import — imports one Google calendar into NVCAL. */
export const ImportGoogleCalendarSchema = z.object({
	googleCalendarId: z.string().min(1),
	name: z.string().trim().min(1, "Name is required"),
	color_hex: z.string().default("#FFFFFF"),
	timezone: z.string().trim().min(1).default("UTC"),
});

export type ImportGoogleCalendarInput = z.input<typeof ImportGoogleCalendarSchema>;
export type ImportGoogleCalendar = z.output<typeof ImportGoogleCalendarSchema>;
