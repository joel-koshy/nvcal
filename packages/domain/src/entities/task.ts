import { z } from "zod";

/** Task lifecycle status. */
export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TaskStatus = z.output<typeof TaskStatusSchema>;

/** Task entity — canonical single source for future API + DB rows. */
export const TaskSchema = z.object({
	id: z.string(),
	calendar_id: z.string(),
	title: z.string().min(1),
	description: z.string().nullable().default(null),
	status: TaskStatusSchema.default("pending"),
	target_steps: z.number().int().min(1).default(1),
	completed_steps: z.number().int().min(0).default(0),
	due_date: z.string().nullable().default(null),
	version: z.number().int().min(1),
});

/** Task as stored / returned (defaults materialized). */
export type Task = z.output<typeof TaskSchema>;
/** Full-entity input (defaulted fields may be omitted). */
export type TaskFields = z.input<typeof TaskSchema>;