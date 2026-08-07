import { Hono } from "hono";
import type { Bindings, Variables } from "../../../types"
import { getValidTokenGoogle } from "../../../util/oauth";
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { Job, JobAction, Providers } from "../../../queue";
import { typedJson } from "../../../util/typed";
import { CalendarListResponseSchema } from "@nvcal/domain";

interface GoogleCalendarListResponse {
	items: Array<{
		id: string;
		summary: string;
		description?: string;
		backgroundColor?: string;
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
		color: cal.backgroundColor
	}));

	return typedJson(c, CalendarListResponseSchema, { calendars: availableCalendars });
})


const importRequestSchema = z.object({
	googleCalendarIds: z.array(z.string()).min(1)
})
googleSyncRouter.post('/import', zValidator('json', importRequestSchema), async (c) => {
	const userId = c.get("userId");
	const { googleCalendarIds } = c.req.valid('json');

	const batchUpserts = []
	const qJobs: Job[] = []
	for (const googleCalId of googleCalendarIds) {
		const localCalendarId = crypto.randomUUID();
		batchUpserts.push(
			c.env.DB.prepare(`
				INSERT INTO calendars (id, user_id, name, is_external, external_provider, external_calendar_id)
				VALUES (?, ?, ?, 1, 'google', ? )
				ON CONFLICT (external_calendar_id) DO UPDATE SET external_provider = 'google'
			`).bind(localCalendarId, userId, "TO BE CHANGED", googleCalId)
		)

		qJobs.push({
			action: JobAction.IMPORT_CAL,
			payload: {
				provider: Providers.GOOGLE,
				userId: userId,
				localCalendarId: localCalendarId,
				externalCalendarId: googleCalId
			}
		});
	}

	await c.env.DB.batch(batchUpserts);
	for (const job of qJobs) {
		c.env.SYNC_QUEUE.send(job);

	}

	return new Response(null, { status: 202 });
})

export default googleSyncRouter;
