import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod'
import { CreateEventSchema, TimeWindowSchema, UpdateEventSchema, EventListResponseSchema, EventResponseSchema, EventConflictResponseSchema } from '@nvcal/domain';
import type { Bindings, Variables } from '../../types';
import { JobAction, Providers, type Job } from '../../queue';
import { typedJson } from '../../util/typed';

const eventsRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();

eventsRouter.get("/", zValidator('query', TimeWindowSchema), async (c) => {
	const { start, end } = c.req.valid('query');
	const userId = c.get("userId");

	if (new Date(end).getTime() - new Date(start).getTime() > 62 * 24 * 60 * 60 * 1000) {
		return c.json({ error: "Time window too large. Maximum allowed is 62 days." }, 400);
	}

	const { results, success } = await c.env.DB
		.prepare(`
			SELECT e.*
			FROM events e
			INNER JOIN calendars c ON e.calendar_id = c.id
			WHERE (c.user_id = ?) AND (e.start_time BETWEEN ? AND ?)
			ORDER BY e.start_time ASC
		`)
		.bind(userId, start, end)
		.all();

	if (!success) {
		return c.json({ error: "Database Error" }, 500);
	}

	return typedJson(c, EventListResponseSchema, { events: results }, 200);
})


eventsRouter.post("/", zValidator("json", CreateEventSchema), async (c) => {
	const data = c.req.valid("json");
	const userId = c.get("userId");
	const calendar = await c.env.DB.
		prepare(`
			SELECT is_external, external_calendar_id FROM calendars
			WHERE id = ? AND user_id = ?
		`).bind(data.calendar_id, userId)
		.first<{ is_external: number; external_calendar_id: string }>();

	if (!calendar) {
		return c.json({ error: "Calendar not Found" }, 404);
	}

	const eventId = crypto.randomUUID()
	const { success } = await c.env.DB.
		prepare(`
			INSERT INTO events (id, calendar_id, task_id, title, description, start_time, end_time, is_all_day, rrule, external_event_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
		`)
		.bind(
			eventId,
			data.calendar_id,
			data.task_id ?? null,
			data.title,
			data.description,
			data.start_time,
			data.end_time,
			data.is_all_day,
			data.rrule ?? null,
			data.external_event_id ?? null
		).run();

	if (!success) {
		return c.json({ error: "Database Error" }, 500);
	}

	const event = await c.env.DB.
		prepare(`SELECT * FROM events WHERE id = ?`)
		.bind(eventId)
		.first();
	if (calendar.is_external) {
		const job: Job = {
			payload: {
				action: 'POST',
				provider: Providers.GOOGLE,
				userId: userId,
				eventId: eventId,
				externalCalendarId: calendar.external_calendar_id
			},
			action: JobAction.EXPORT_EVENT
		}
		c.env.SYNC_QUEUE.send(job);
		return typedJson(c, EventResponseSchema, { event }, 202);
	}

	return typedJson(c, EventResponseSchema, { event }, 201);
})


eventsRouter.put("/:id", zValidator("json", UpdateEventSchema), async (c) => {
	const userId = c.get("userId");
	const eventId = c.req.param("id")
	const data = c.req.valid("json");

	// 1. Verify the event exists and belongs to the user
	const existingOwnership = await c.env.DB.
		prepare(`
			SELECT e.id, c.is_external FROM calendars c
			INNER JOIN events e ON e.calendar_id = c.id
			WHERE c.user_id = ? AND e.id = ?
		`)
		.bind(userId, eventId)
		.first();
	if (!existingOwnership) {
		return c.json({ error: "Event not found" }, 404);
	}

	// 2. Verify the target calendar belongs to the user
	const targetCalendar = await c.env.DB.
		prepare(`
			SELECT is_external, external_calendar_id FROM calendars
			WHERE id = ? AND user_id = ?
		`)
		.bind(data.calendar_id, userId)
		.first<{ is_external: number; external_calendar_id: string }>();
	if (!targetCalendar) {
		return c.json({ error: "Calendar not Found" }, 404);
	}

	const { meta } = await c.env.DB.
		prepare(`
			UPDATE events
			SET
				calendar_id = ?,
				task_id = ?,
				title = ?,
				description = ?,
				start_time = ?,
				end_time = ?,
				is_all_day = ?,
				rrule = ?,
				external_event_id = ?,
				version = version + 1
			WHERE id = ? AND version = ?
		`)
		.bind(
			data.calendar_id,
			data.task_id ?? null,
			data.title,
			data.description,
			data.start_time,
			data.end_time,
			data.is_all_day,
			data.rrule ?? null,
			data.external_event_id ?? null,
			eventId,
			data.version,
		).run();

	if (meta.changes == 0) {
		const existingEvent = await c.env.DB.
			prepare(`
				SELECT * FROM events
				WHERE id = ?
			`).bind(eventId).first()
		if (!existingEvent) {
			return c.json({ error: "Event not found" }, 404);
		}
		// Existing event suggests we failed because of version mismatch
		return typedJson(c, EventConflictResponseSchema, { error: "Conflict", currentState: existingEvent }, 409);
	}

	const updatedEvent = await c.env.DB.
		prepare(`
			SELECT * FROM events
			WHERE id = ?
		`).bind(eventId).first();

	if (targetCalendar.is_external) {
		const job: Job = {
			payload: {
				action: 'PUT',
				provider: Providers.GOOGLE,
				userId: userId,
				eventId: eventId,
				externalCalendarId: targetCalendar.external_calendar_id
			},
			action: JobAction.EXPORT_EVENT
		}
		c.env.SYNC_QUEUE.send(job);
		return typedJson(c, EventResponseSchema, { event: updatedEvent }, 202);
	}

	return typedJson(c, EventResponseSchema, { event: updatedEvent }, 200);
})

const DeleteSchema = z.object({
	version: z.coerce.number().min(1, "Version is required")
});
eventsRouter.delete("/:id", zValidator("query", DeleteSchema), async (c) => {
	const userId = c.get("userId");
	const eventId = c.req.param("id");
	const { version } = c.req.valid('query');

	// check if the event exists and is owned by the user
	const calData = await c.env.DB.
		prepare(`
			SELECT e.external_event_id, c.is_external, c.external_calendar_id FROM calendars c
			INNER JOIN events e ON e.calendar_id = c.id
			WHERE c.user_id = ? AND e.id = ?
		`).bind(userId, eventId)
		.first<{ external_event_id: string | null; is_external: number; external_calendar_id: string }>();
	if (!calData) {
		return c.json({ error: "Event not found" }, 404);
	}

	const { meta } = await c.env.DB.
		prepare(`
			DELETE FROM events
			WHERE id == ? AND version= ?
		`).bind(eventId, version)
		.run();

	if (meta.changes == 0) {
		const currentState = await c.env.DB.prepare(
			"SELECT * FROM events WHERE id = ?"
		).bind(eventId).first();
		return typedJson(c, EventConflictResponseSchema, { error: "Conflict", currentState }, 409);
	}

	if (calData.is_external) {
		// Only enqueue a Google delete when the event was actually exported.
		// If external_event_id is null there is nothing on Google to remove.
		if (calData.external_event_id) {
			const job: Job = {
				payload: {
					action: 'DELETE',
					provider: Providers.GOOGLE,
					userId: userId,
					externalCalendarId: calData.external_calendar_id,
					externalEventId: calData.external_event_id
				},
				action: JobAction.EXPORT_EVENT
			}
			c.env.SYNC_QUEUE.send(job);
		}
		return c.body(null, 204);
	}


	return c.body(null, 204);
})

export default eventsRouter;
