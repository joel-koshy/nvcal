import { z } from "zod";

/** Generic error envelope used by every JSON endpoint. */
export const ErrorResponseSchema = z.object({
	error: z.string(),
});
export type ErrorResponse = z.output<typeof ErrorResponseSchema>;

/** `{ success: true }` body (e.g. logout). */
export const SuccessResponseSchema = z.object({
	success: z.literal(true),
});
export type SuccessResponse = z.output<typeof SuccessResponseSchema>;