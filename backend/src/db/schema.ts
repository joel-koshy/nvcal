import { z } from "zod";

const BaseEventSchema = z.object({
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
})
const eventTimeRefine = {
	refinement: (data: { start_time: string; end_time: string }) =>
		new Date(data.end_time) > new Date(data.start_time),
	message: "end_time must be after start_time",
	path: ["end_time" as const],
}

export const CreateEventSchema = BaseEventSchema.omit({ id: true, version: true })
	.extend({
		task_id: z.string().nullable().optional(),
		rrule: z.string().nullable().optional(),
		external_event_id: z.string().nullable().optional(),
	})
	.refine(
		eventTimeRefine.refinement,
		{ message: eventTimeRefine.message, path: eventTimeRefine.path }
	)

export const UpdateEventSchema = BaseEventSchema.omit({ id: true })
	.extend({
		task_id: z.string().nullable().optional(),
		rrule: z.string().nullable().optional(),
		external_event_id: z.string().nullable().optional(),
	})
	.refine(eventTimeRefine.refinement, {
		message: eventTimeRefine.message,
		path: eventTimeRefine.path,
	})

export const TimeWindowSchema = z.object({
	start: z.iso.datetime({ message: "Invalid datetime format" }),
	end: z.iso.datetime({ message: "Invalid datetime format" }),
}).refine(data => new Date(data.end) > new Date(data.start), {
	message: "end must be after start_time",
	path: ["end"]
})



