import { z } from "zod";
import { EventSchema } from "../entities/event";

const eventTimeRefine = {
	refinement: (data: { start_time: string; end_time: string }) =>
		new Date(data.end_time) > new Date(data.start_time),
	message: "end_time must be after start_time",
	path: ["end_time" as const],
};

export const CreateEventSchema = EventSchema.omit({ id: true, version: true })
	.extend({
		task_id: z.string().nullable().optional(),
		rrule: z.string().nullable().optional(),
		external_event_id: z.string().nullable().optional(),
	})
	.refine(eventTimeRefine.refinement, {
		message: eventTimeRefine.message,
		path: eventTimeRefine.path,
	});

export const UpdateEventSchema = EventSchema.omit({ id: true })
	.extend({
		task_id: z.string().nullable().optional(),
		rrule: z.string().nullable().optional(),
		external_event_id: z.string().nullable().optional(),
	})
	.refine(eventTimeRefine.refinement, {
		message: eventTimeRefine.message,
		path: eventTimeRefine.path,
	});

export const TimeWindowSchema = z
	.object({
		start: z.iso.datetime({ message: "Invalid datetime format" }),
		end: z.iso.datetime({ message: "Invalid datetime format" }),
	})
	.refine((data) => new Date(data.end) > new Date(data.start), {
		message: "end must be after start",
		path: ["end"],
	});

/** Request types — what the client sends. */
export type CreateEventInput = z.input<typeof CreateEventSchema>;
export type UpdateEventInput = z.input<typeof UpdateEventSchema>;
export type TimeWindow = z.input<typeof TimeWindowSchema>;

/** Validated types the server works with. */
export type CreateEvent = z.output<typeof CreateEventSchema>;
export type UpdateEvent = z.output<typeof UpdateEventSchema>;