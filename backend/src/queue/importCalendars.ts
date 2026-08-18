import { ImportJobPayload, JobAction, Providers, SetupWebhookPayload } from ".";
import { Bindings } from "../types";
import { getValidTokenGoogle } from "../util/oauth";

interface GoogleCalendarEventResponse {
	items: Array<{
		id: string;
		summary?: string;
		description?: string;
		status: string;
		start: {
			dateTime?: string;
			date?: string;
		};
		end: {
			dateTime?: string;
			date?: string;
		};
	}>,
	nextPageToken?: string;
	nextSyncToken?: string;
}

const timeMax = new Date().toISOString();
const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

export async function importExternalCalendars(payload: ImportJobPayload, env: Bindings) {
	switch (payload.provider) {
		case Providers.GOOGLE:
			await importGoogleCals(payload, env);
	}
}

async function importGoogleCals(payload: ImportJobPayload, env: Bindings) {
	const pageToken = payload.pageToken || null;
	const encodedId = encodeURIComponent(payload.externalCalendarId);
	let url = `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&fields=nextPageToken,nextSyncToken,items(id,summary,description,start,end,status)&maxResults=100`;
	if (pageToken) url += `&pageToken=${pageToken}`;

	const userId = payload.userId;
	const accessToken = await getValidTokenGoogle(env, userId)
	const res = await fetch(
		url,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});
	const data = await res.json() as GoogleCalendarEventResponse

	const batchUpserts = data.items.
		filter(item => item.status != 'cancelled').
		map(item => {
			return env.DB.prepare(
				`
				INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id )
				VALUES (?, ?, ?, ?, ?, 'google', ? )
				ON CONFLICT (external_event_id) DO UPDATE SET
					title = excluded.title,
					start_time = excluded.start_time,
					end_time = excluded.end_time,
					version = version + 1
				WHERE
				events.title != excluded.title OR
    		IFNULL(events.description, '') != IFNULL(excluded.description, '') OR
    		events.start_time != excluded.start_time OR
    		events.end_time != excluded.end_time OR
    		events.is_all_day != excluded.is_all_day;
				`
			).bind(							// WHERE clause ensure we only update rows if different - saving on reads.
				crypto.randomUUID(),
				payload.localCalendarId,
				item.summary || 'Untitled',
				item.start.dateTime || item.start.date,
				item.end.dateTime || item.end.date,
				item.id
			);
		});
	if (batchUpserts.length > 0) {
		await env.DB.batch(batchUpserts);
	}

	if (data.nextPageToken) {
		await env.SYNC_QUEUE.send({
			action: JobAction.IMPORT_CAL,
			payload: {
				provider: Providers.GOOGLE,
				userId: userId,
				localCalendarId: payload.localCalendarId,
				externalCalendarId: payload.externalCalendarId,
				pageToken: data.nextPageToken
			}
		});
	}
	else if (data.nextSyncToken) {
		await env.DB.prepare(
			`UPDATE calendars SET sync_token = ? WHERE id = ?`
		).bind(data.nextSyncToken, payload.localCalendarId).run();

		const job: SetupWebhookPayload = {
			userId: userId,
			provider: Providers.GOOGLE,
			calendarId: payload.localCalendarId
		}
		await env.SYNC_QUEUE.send(
			{
				action: JobAction.SETUP_WEBHOOK_WATCH,
				payload: job
			}
		)
	}
	else {
		throw new Error("Fatal: Google returned no pagination or sync tokens.");
	}
}
