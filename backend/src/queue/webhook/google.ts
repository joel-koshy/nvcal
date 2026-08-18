import { ImportJobPayload, JobAction, ProcessWebhookPayload, Providers, SetupWebhookPayload } from "..";
import type { Bindings } from "../../types";
import { getValidTokenGoogle } from "../../util/oauth";

interface GoogleWatchResponse {
	resourceId: string;
}

interface CalendarRow {
	id: string;
	user_id: string;
	sync_channel_id: string;
	sync_token: string | null;
	external_calendar_id: string;
}

interface GoogleSyncResponse {
	nextSyncToken?: string;
	items?: Array<{
		id: string;
		status?: string;
		summary?: string;
		description?: string;
		start: { dateTime?: string; date?: string };
		end: { dateTime?: string; date?: string };
	}>;
}

export async function setupGoogleWebhook(job: SetupWebhookPayload, env: Bindings) {
	// 1. get user id
	const userId = job.userId;

	// 2. calendar id to sync (from payload)
	const calendarId = job.calendarId;

	//     2.1 if calendar is already being synced - throw and error.
	//      -- what happens if user is attempting to reset a sync issue?
	//      -- may be they disconnected from google and then relogged in and now are trying to sync again?
	const existingCalendar = await env.DB.prepare(
		`
        SELECT sync_channel_id, external_calendar_id FROM calendars
        WHERE user_id = ? AND id = ?
        `
	).bind(userId, calendarId).first<{ external_calendar_id: string }>();
	if (!existingCalendar) {
		throw new Error("Calendar does not exist")
	}

	// 3. generate local sync channel to identify payload from google - (google cannot auth with us)
	//  -- upsert on re-setup

	const syncChannelId = crypto.randomUUID();
	// 4. Call Google to setup webhook
	const authToken = await getValidTokenGoogle(env, userId);
	const encodedProviderId = encodeURIComponent(existingCalendar.external_calendar_id);
	const targetUrl = env.APP_URL + "/webhooks/google";
	const watchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedProviderId}/events/watch`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${authToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			id: syncChannelId, // NVCAL's unique ID for this channel
			type: 'web_hook',
			address: targetUrl, // Where Google will ping us
		}),
	});
	const watchData = await watchRes.json() as GoogleWatchResponse;
	if (!watchRes.ok) {
		throw new Error(`Google Watch Failed: ${JSON.stringify(watchData)}`);
	}

	// 5. update calendar with google provided resource id
	await env.DB.prepare(
		`
            UPDATE calendars
            SET sync_channel_id = ?, sync_resource_id = ?
            WHERE user_id = ? AND id = ?
        `
	).bind(syncChannelId, watchData.resourceId, userId, calendarId).run();

}

// delta handler such a cool name
export async function processGoogleWebhook(job: ProcessWebhookPayload, env: Bindings) {
	// 1. we have per calendar based sync ids, get that
	const calData = await env.DB.prepare(
		`
            SELECT id, user_id, sync_channel_id, sync_token, external_calendar_id FROM calendars
            WHERE sync_channel_id = ?
        `
	).bind(job.channelId).first<CalendarRow>();
	if (!calData) {
		return;// Webhook for a deleted/non existing calendar - safe to ignore
	}
	if (!calData.sync_token) {
		return;
		// only happen if import hasn't been completed yet
		// import is still being processed - i.e this webhook call will have data that we will/already import(ed)
		// Or is a test call from google. Safe to ignore.
	}

	// 2. Get access token (Now we have 2 seperate SQL calls to get auth tokens - is this inefficient?)
	const accessToken = await getValidTokenGoogle(env, calData.user_id);
	const encodedProviderId = encodeURIComponent(calData.external_calendar_id);
	let fetchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodedProviderId}/events`;
	fetchUrl += `?syncToken=${calData.sync_token}`;
	const syncRes = await fetch(fetchUrl, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (syncRes.status === 410) {
		console.warn(`Sync token expired for calendar ${calData.id}. Initiating state reconciliation.`);
		await env.DB.prepare(`UPDATE calendars SET sync_token = NULL WHERE id = ?`)
			.bind(calData.id).run();

		const job: ImportJobPayload = {
			userId: calData.user_id,
			localCalendarId: calData.id,
			externalCalendarId: calData.external_calendar_id,
			provider: Providers.GOOGLE,
		}
		await env.SYNC_QUEUE.send({
			action: JobAction.IMPORT_CAL,
			payload: job
		});

		return;
	}
	const syncData = await syncRes.json() as GoogleSyncResponse;

	// Perform updates on db:
	const batchStatements = [];
	for (const item of syncData.items || []) {
		if (item.status === 'cancelled') {
			await env.DB.prepare(`DELETE FROM events WHERE external_event_id = ?`).bind(item.id).run();
		} else {
			const startTime = item.start.dateTime || item.start.date;
			const endTime = item.end.dateTime || item.end.date;
			const isAllDay = item.start.date ? 1 : 0;
			const eventId = crypto.randomUUID();

			batchStatements.push(
				env.DB.prepare(`
                        INSERT INTO events (id, calendar_id, title, description, start_time, end_time, is_all_day,
                                                                external_provider, external_event_id, version)
                        VALUES (?, ?, ?, ?, ?, ?, ?,
                                        'google', ?, 1)
                        ON CONFLICT(external_event_id) DO UPDATE SET
                        title = excluded.title,
                        description = excluded.description,
                        start_time = excluded.start_time,
                        end_time = excluded.end_time,
                        is_all_day = excluded.is_all_day,
                        version = version + 1
                    WHERE
                        events.title != excluded.title OR
                        IFNULL(events.description, '') != IFNULL(excluded.description, '') OR
                        events.start_time != excluded.start_time OR
                        events.end_time != excluded.end_time OR
                        events.is_all_day != excluded.is_all_day;
                    `).bind(
					eventId,
					calData.id,
					item.summary || 'Untitled Event',
					item.description || null,
					startTime,
					endTime,
					isAllDay,
					item.id
				)
			);
		}
	}

	if (batchStatements.length > 0) {
		await env.DB.batch(batchStatements);
	}

	if (syncData.nextSyncToken) {
		await env.DB.prepare(`
            UPDATE calendars SET sync_token = ? WHERE user_id = ? AND id = ?
        `).bind(syncData.nextSyncToken, calData.user_id, calData.id).run();
	}

}
