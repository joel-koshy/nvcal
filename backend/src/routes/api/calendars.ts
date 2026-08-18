import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
	CalendarConflictResponseSchema,
	CalendarListResponseSchema,
	CalendarResponseSchema,
	CreateCalendarSchema,
	UpdateCalendarSchema,
} from "@nvcal/domain";
import type { Bindings, Variables } from "../../types";
import { typedJson } from "../../util/typed";

const calendarRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();

// List calendars owned by the user
calendarRouter.get("/", async (c) => {
	const userId = c.get("userId");
	const { results, success } = await c.env.DB
		.prepare(`
			SELECT * FROM calendars
			WHERE user_id = ?
			ORDER BY name ASC
		`)
		.bind(userId)
		.all();

	if (!success) {
		return c.json({ error: "Database Error" }, 500);
	}

	return typedJson(c, CalendarListResponseSchema, { calendars: results }, 200);
})

// Create a local calendar
calendarRouter.post("/", zValidator("json", CreateCalendarSchema), async (c) => {
	const userId = c.get("userId");
	const data = c.req.valid("json");

	const calendarId = crypto.randomUUID();
	const { success } = await c.env.DB
		.prepare(`
			INSERT INTO calendars (id, user_id, name, color_hex, timezone, is_external, external_provider, external_calendar_id, sync_token, sync_channel_id, sync_resource_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
		.bind(
			calendarId,
			userId, // Ownership always comes from the session, never the body.
			data.name,
			data.color_hex,
			data.timezone,

			data.is_external,
			data.external_provider,
			data.external_calendar_id,
			data.sync_token,
			data.sync_channel_id,
			data.sync_resource_id,
		)
		.run();

	if (!success) {
		return c.json({ error: "Database Error" }, 500);
	}

	const calendar = await c.env.DB
		.prepare(`SELECT * FROM calendars WHERE id = ?`)
		.bind(calendarId)
		.first();

	return typedJson(c, CalendarResponseSchema, { calendar }, 201);
})

// Update calendar configuration (optimistic concurrency on version)
calendarRouter.put("/:id", zValidator("json", UpdateCalendarSchema), async (c) => {
	const userId = c.get("userId");
	const calendarId = c.req.param("id");
	const data = c.req.valid("json");

	// 1. Verify the calendar exists and belongs to the user
	const owned = await c.env.DB
		.prepare(`SELECT id FROM calendars WHERE id = ? AND user_id = ?`)
		.bind(calendarId, userId)
		.first();
	if (!owned) {
		return c.json({ error: "Calendar not found" }, 404);
	}

	// 2. Optimistic-concurrency update — only applies when versions match
	const { meta } = await c.env.DB
		.prepare(`
			UPDATE calendars
			SET
				name = ?,
				color_hex = ?,
				timezone = ?,
				is_external = ?,
				external_provider = ?,
				external_calendar_id = ?,
				sync_token = ?,
				sync_channel_id = ?,
				sync_resource_id = ?,
				version = version + 1
			WHERE id = ? AND version = ?
		`)
		.bind(
			data.name,
			data.color_hex,
			data.timezone,
			data.is_external,
			data.external_provider,
			data.external_calendar_id,
			data.sync_token,
			data.sync_channel_id,
			data.sync_resource_id,
			calendarId,
			data.version,
		)
		.run();

	if (meta.changes === 0) {
		const currentState = await c.env.DB
			.prepare(`SELECT * FROM calendars WHERE id = ?`)
			.bind(calendarId)
			.first();
		if (!currentState) {
			return c.json({ error: "Calendar not found" }, 404);
		}
		return typedJson(c, CalendarConflictResponseSchema, { error: "Conflict", currentState }, 409);
	}

	const updated = await c.env.DB
		.prepare(`SELECT * FROM calendars WHERE id = ?`)
		.bind(calendarId)
		.first();

	return typedJson(c, CalendarResponseSchema, { calendar: updated }, 200);
})

const DeleteSchema = z.object({
	version: z.coerce.number().min(1, "Version is required")
});

// Delete a calendar (cascades to events) — optimistic concurrency on version
calendarRouter.delete("/:id", zValidator("query", DeleteSchema), async (c) => {
	const userId = c.get("userId");
	const calendarId = c.req.param("id");
	const { version } = c.req.valid("query");

	// 1. Verify the calendar exists and belongs to the user
	const owned = await c.env.DB
		.prepare(`SELECT id FROM calendars WHERE id = ? AND user_id = ?`)
		.bind(calendarId, userId)
		.first();
	if (!owned) {
		return c.json({ error: "Calendar not found" }, 404);
	}

	// 2. Optimistic-concurrency delete — only when versions match
	const { meta } = await c.env.DB
		.prepare(`DELETE FROM calendars WHERE id = ? AND version = ?`)
		.bind(calendarId, version)
		.run();

	if (meta.changes === 0) {
		const currentState = await c.env.DB
			.prepare(`SELECT * FROM calendars WHERE id = ?`)
			.bind(calendarId)
			.first();
		return typedJson(c, CalendarConflictResponseSchema, { error: "Conflict", currentState }, 409);
	}

	return c.body(null, 204);
})

export default calendarRouter;
