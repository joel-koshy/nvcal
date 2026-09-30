import { Hono } from "hono";
import type { Bindings, Variables } from "../../../types"
import { getValidTokenGoogle } from "../../../util/oauth";
import { zValidator } from "@hono/zod-validator";
import { JobAction, Providers } from "../../../queue";
import { typedJson } from "../../../util/typed";
import { GoogleCalendarListResponseSchema, ImportGoogleCalendarSchema } from "@nvcal/domain";

interface GoogleCalendarListResponse {
	items: Array<{
		id: string;
		summary: string;
		description?: string;
		backgroundColor?: string;
		timeZone?: string;
	}>;
}

const googleSyncRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>();

// Calendar Discovery Route
googleSyncRouter.get('/calendars', async (c) => {
	const userId = c.get("userId");
	const accessToken = await getValidTokenGoogle(c.env, userId);

	const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!response.ok) return c.json({ error: "Failed to fetch Google calendars" }, 500);
	const data = await response.json() as GoogleCalendarListResponse;

	const availableCalendars = data.items.map(cal => ({
		id: cal.id,
		name: cal.summary,
		description: cal.description || "",
		color: cal.backgroundColor,
		timezone: cal.timeZone,
	}));

	return typedJson(c, GoogleCalendarListResponseSchema, { calendars: availableCalendars });
})


googleSyncRouter.post('/import', zValidator('json', ImportGoogleCalendarSchema), async (c) => {
	const userId = c.get("userId");
	const { googleCalendarId, name, color_hex, timezone } = c.req.valid('json');
	const existing = await c.env.DB
		.prepare(`SELECT id FROM calendars WHERE user_id = ? AND external_calendar_id = ?`)
		.bind(userId, googleCalendarId)
		.first<{ id: string }>();
	const localCalendarId = existing?.id ?? crypto.randomUUID();

	const { success } = existing
		? await c.env.DB
			.prepare(`
				UPDATE calendars
				SET name = ?, color_hex = ?, timezone = ?, external_provider = 'google'
				WHERE id = ? AND user_id = ?
			`)
			.bind(name, color_hex, timezone, localCalendarId, userId)
			.run()
		: await c.env.DB
			.prepare(`
				INSERT INTO calendars (id, user_id, name, color_hex, timezone, is_external, external_provider, external_calendar_id)
				VALUES (?, ?, ?, ?, ?, 1, 'google', ?)
			`)
			.bind(localCalendarId, userId, name, color_hex, timezone, googleCalendarId)
			.run();

	if (!success) return c.json({ error: "Failed to create calendar" }, 500);

	await c.env.SYNC_QUEUE.send({
		action: JobAction.IMPORT_CAL,
		payload: {
			provider: Providers.GOOGLE,
			userId,
			localCalendarId,
			externalCalendarId: googleCalendarId,
		},
	});

	return new Response(null, { status: 202 });
})

export default googleSyncRouter;
