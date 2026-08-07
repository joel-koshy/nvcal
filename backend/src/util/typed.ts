import type { Context, StatusCode } from "hono";
import type { z } from "zod";

/**
 * Build a JSON response whose shape is enforced against a unified
 * @ncal/domain response schema. The assembled body (DB rows / DTOs) is
 * validated at runtime; a drift from the declared contract is a 500 rather
 * than a silently-inconsistent payload.
 */
export function typedJson<S extends z.ZodType>(
	c: Context,
	schema: S,
	body: unknown,
	status: StatusCode = 200,
): Response | Promise<Response> {
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		console.error("[typedJson] response failed contract", parsed.error.issues);
		return c.json({ error: "Internal Server Error" }, 500);
	}
	return c.json(parsed.data, status);
}