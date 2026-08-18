import { ExportEventPayload } from "..";
import { Bindings } from "../../types";
import { getValidTokenGoogle } from "../../util/oauth";

interface D1EventRow {
	id: string;
	calendar_id: string;
	title: string;
	description: string | null;
	start_time: string;
	end_time: string;
	is_all_day: number;
	rrule: string | null;
	external_event_id: string | null;
	version: number;
}

export async function exportGoogleEvents(job: ExportEventPayload, env: Bindings) {
	let googlePayload: unknown;
	let method = 'POST';

	let url = `https://www.googleapis.com/calendar/v3/calendars/${job.externalCalendarId}/events`;
	if (job.action === 'DELETE') {
		if (!job.externalEventId || !job.externalCalendarId) {
			throw new Error('DELETE requires externalEventId and externalCalendarId');
		}
		url = `https://www.googleapis.com/calendar/v3/calendars/${job.externalCalendarId}/events/${job.externalEventId}`;
		method = 'DELETE';
		googlePayload = null;
	} else {
		let event = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(job.eventId).first<D1EventRow>();
		if (!event) throw new Error("Queue Found Invalid Event ID");
		if (job.action === 'PUT' && event.external_event_id) {
			url += `/${event.external_event_id}`;
			method = 'PATCH'
		}

		const isAllDay = event.is_all_day === 1;
		const startFormat = isAllDay
			? { date: event.start_time.split('T')[0] } // Extract YYYY-MM-DD
			: { dateTime: new Date(event.start_time).toISOString() };

		const endFormat = isAllDay
			? { date: event.end_time.split('T')[0] }
			: { dateTime: new Date(event.end_time).toISOString() };

		googlePayload = {
			summary: event.title,
			description: event.description ?? null,
			start: startFormat,
			end: endFormat,
		};

	}

	const accessToken = await getValidTokenGoogle(env, job.userId);
	const response = await fetch(url, {
		method,
		headers: {
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: googlePayload ? JSON.stringify(googlePayload) : undefined
	});
	if (!response.ok) {
		const errorText = await response.text(); 
		throw new Error(`Google API Error ${response.status}: ${errorText}`);
	}

	if (method === 'POST') {
		const googleData = await response.json() as { id: string };
		await env.DB.prepare(`
            UPDATE events
            SET external_event_id = ?
            WHERE id = ?
          `).bind(googleData.id, job.eventId).run();
	}

}
