import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { exportGoogleEvents } from '../src/queue/export/google';
import { Providers, type ExportEventPayload } from '../src/queue';
import type { Bindings } from '../src/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_USER_ID = 'usr_test_123';
const LOCAL_CAL_ID = 'local-cal-uuid';
const GOOGLE_CAL_ID = 'calendar-id@group.calendar.google.com';
const EVENT_ID = 'event-uuid-001';
const GOOGLE_EVENT_ID = 'gcal-event-001';

const ACCESS_TOKEN = 'ya29.valid_access_token';
const REFRESH_TOKEN = 'valid_refresh_token';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedOAuthConnection(overrides?: { expires_at?: number; refresh_token?: string | null }) {
	const expiresAt = overrides?.expires_at ?? Math.floor(Date.now() / 1000) + 3600;
	const refreshToken = overrides && 'refresh_token' in overrides ? overrides.refresh_token : REFRESH_TOKEN;
	await env.DB.prepare(
		`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
		 VALUES (?, ?, 'google', ?, ?, ?, ?)`
	).bind(
		'oc_export_test',
		VALID_USER_ID,
		'google-sub-export',
		ACCESS_TOKEN,
		refreshToken,
		expiresAt
	).run();
}

async function seedExternalCalendar() {
	await env.DB.prepare(
		`INSERT INTO calendars (id, user_id, name, timezone, is_external, external_calendar_id)
		 VALUES (?, ?, ?, ?, 1, ?)`
	).bind(LOCAL_CAL_ID, VALID_USER_ID, 'Google Synced Cal', 'UTC', GOOGLE_CAL_ID).run();
}

async function seedEvent(overrides?: { external_event_id?: string | null; title?: string; description?: string }) {
	await env.DB.prepare(
		`INSERT INTO events (id, calendar_id, title, description, start_time, end_time, is_all_day, version, external_event_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
	).bind(
		EVENT_ID,
		LOCAL_CAL_ID,
		overrides?.title ?? 'Team Standup',
		overrides?.description ?? 'Daily sync',
		'2026-06-28T09:00:00Z',
		'2026-06-28T09:30:00Z',
		0,
		overrides?.external_event_id ?? null,
	).run();
}

function makeJob(overrides?: Partial<ExportEventPayload>): ExportEventPayload {
	return {
		userId: VALID_USER_ID,
		eventId: EVENT_ID,
		provider: Providers.GOOGLE,
		action: 'POST',
		externalCalendarId: GOOGLE_CAL_ID,
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Queue: exportGoogleEvents (Google)', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		await seedExternalCalendar();
		await seedEvent();

		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 1. POST — Create new event on Google Calendar
	// ──────────────────────────────────────────────────────────────────────────
	describe('1. POST action (Create on Google)', () => {
		it('should POST to the correct Google Calendar API endpoint with the correct payload', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: GOOGLE_EVENT_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];

			// URL should target the calendar's events collection
			expect(url).toBe(
				`https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CAL_ID}/events`
			);
			expect(opts.method).toBe('POST');

			// Headers
			expect(opts.headers).toEqual(
				expect.objectContaining({
					Authorization: `Bearer ${ACCESS_TOKEN}`,
					'Content-Type': 'application/json',
				})
			);

			// Body payload
			const body = JSON.parse(opts.body as string);
			expect(body).toEqual({
				summary: 'Team Standup',
				description: 'Daily sync',
				start: { dateTime: '2026-06-28T09:00:00.000Z' },
				end: { dateTime: '2026-06-28T09:30:00.000Z' },
			});

			vi.restoreAllMocks();
		});

		it('should save the Google event ID back to D1 after successful POST', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: GOOGLE_EVENT_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			// Before export — no external_event_id
			const before = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string | null }>();
			expect(before?.external_event_id).toBeNull();

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			// After export — external_event_id should be set
			const after = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string | null }>();
			expect(after?.external_event_id).toBe(GOOGLE_EVENT_ID);

			vi.restoreAllMocks();
		});

		it('should handle event with null description', async () => {
			await env.DB.prepare(
				`UPDATE events SET description = NULL WHERE id = ?`
			).bind(EVENT_ID).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'gcal-new-event' }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			const body = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
			expect(body.description).toBeNull();
			// Google accepts null description; the payload should still include the key

			vi.restoreAllMocks();
		});

		it('should throw when the event is not found in D1', async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST', eventId: 'nonexistent-id' }), env as unknown as Bindings)
			).rejects.toThrow();

			// Should not have called Google API
			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when the calendar is not found in D1', async () => {
			// Delete the calendar so the worker can't find it
			await env.DB.prepare(
				`DELETE FROM calendars WHERE id = ?`
			).bind(LOCAL_CAL_ID).run();
			// Re-insert event with a dangling FK (or delete it too and create a new one)
			await env.DB.prepare(
				`DELETE FROM events WHERE id = ?`
			).bind(EVENT_ID).run();

			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST', eventId: EVENT_ID }), env as unknown as Bindings)
			).rejects.toThrow();

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when Google API returns a non-ok response', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 403,
				json: async () => ({ error: { message: 'Forbidden' } }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings)
			).rejects.toThrow();

			// external_event_id should NOT be saved on failure
			const after = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string | null }>();
			expect(after?.external_event_id).toBeNull();

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 2. PUT — Update existing event on Google Calendar
	// ──────────────────────────────────────────────────────────────────────────
	describe('2. PUT action (Update on Google)', () => {
		it('should PATCH when the event already has an external_event_id', async () => {
			// Seed event with an existing Google event ID
			await env.DB.prepare(
				`UPDATE events SET external_event_id = ? WHERE id = ?`
			).bind(GOOGLE_EVENT_ID, EVENT_ID).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: GOOGLE_EVENT_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'PUT' }), env as unknown as Bindings);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];

			expect(url).toBe(
				`https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CAL_ID}/events/${GOOGLE_EVENT_ID}`
			);
			expect(opts.method).toBe('PATCH');

			const body = JSON.parse(opts.body as string);
			expect(body.summary).toBe('Team Standup');
			expect(body.start).toEqual({ dateTime: '2026-06-28T09:00:00.000Z' });
			expect(body.end).toEqual({ dateTime: '2026-06-28T09:30:00.000Z' });

			vi.restoreAllMocks();
		});

		it('should POST (create) when the event has no external_event_id', async () => {
			// Event has no external_event_id (default from seedEvent)
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'gcal-created-via-put' }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'PUT' }), env as unknown as Bindings);

			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];

			// Should POST to the calendar events endpoint (no event ID in URL)
			expect(url).toBe(
				`https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CAL_ID}/events`
			);
			expect(opts.method).toBe('POST');

			// Should save the new Google event ID back to D1
			const after = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string | null }>();
			expect(after?.external_event_id).toBe('gcal-created-via-put');

			vi.restoreAllMocks();
		});

		it('should use the new calendar when oldCalendarId differs from current calendar', async () => {
			// Create a second calendar and move the event
			const NEW_CAL_ID = 'new-cal-uuid';
			const NEW_GOOGLE_CAL_ID = 'new-gcal-id@group.calendar.google.com';
			await env.DB.prepare(
				`INSERT INTO calendars (id, user_id, name, timezone, is_external, external_calendar_id)
				 VALUES (?, ?, ?, ?, 1, ?)`
			).bind(NEW_CAL_ID, VALID_USER_ID, 'New Google Cal', 'UTC', NEW_GOOGLE_CAL_ID).run();

			// Move event to new calendar and give it an external_event_id
			await env.DB.prepare(
				`UPDATE events SET calendar_id = ?, external_event_id = ? WHERE id = ?`
			).bind(NEW_CAL_ID, GOOGLE_EVENT_ID, EVENT_ID).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: GOOGLE_EVENT_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({
				action: 'PUT',
				externalCalendarId: NEW_GOOGLE_CAL_ID,
			}), env as unknown as Bindings);

			const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];

			// Should target the NEW calendar
			expect(url).toContain(NEW_GOOGLE_CAL_ID);
			expect(url).toContain(GOOGLE_EVENT_ID);

			vi.restoreAllMocks();
		});

		it('should throw when the event is not found in D1', async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'PUT', eventId: 'nonexistent-id' }), env as unknown as Bindings)
			).rejects.toThrow();

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when Google API returns a non-ok response', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 404,
				json: async () => ({ error: { message: 'Not Found' } }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'PUT' }), env as unknown as Bindings)
			).rejects.toThrow();

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 3. DELETE — Delete event from Google Calendar
	// ──────────────────────────────────────────────────────────────────────────
	describe('3. DELETE action (Delete from Google)', () => {
		it('should DELETE using the provided externalEventId and externalCalendarId', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({
				action: 'DELETE',
				externalEventId: GOOGLE_EVENT_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			}), env as unknown as Bindings);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];

			expect(url).toBe(
				`https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CAL_ID}/events/${GOOGLE_EVENT_ID}`
			);
			expect(opts.method).toBe('DELETE');

			// DELETE should not have a body
			expect(opts.body).toBeUndefined();

			// Headers should still include Authorization
			expect(opts.headers).toEqual(
				expect.objectContaining({
					Authorization: `Bearer ${ACCESS_TOKEN}`,
				})
			);

			vi.restoreAllMocks();
		});

		it('should not attempt to fetch event from D1 (event is already deleted)', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true });
			vi.stubGlobal('fetch', fetchSpy);

			// Delete the event from D1 first (simulating the route's prior DELETE)
			await env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(EVENT_ID).run();

			// Should still succeed — worker uses payload fields, not D1
			await exportGoogleEvents(makeJob({
				action: 'DELETE',
				externalEventId: GOOGLE_EVENT_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			}), env as unknown as Bindings);

			expect(fetchSpy).toHaveBeenCalledTimes(1);

			vi.restoreAllMocks();
		});

		it('should throw when externalEventId is missing from the payload', async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({
					action: 'DELETE',
					// externalEventId intentionally omitted
					externalCalendarId: GOOGLE_CAL_ID,
				}), env as unknown as Bindings)
			).rejects.toThrow();

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when externalCalendarId is missing from the payload', async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents({
					userId: VALID_USER_ID,
					eventId: EVENT_ID,
					provider: Providers.GOOGLE,
					action: 'DELETE',
					externalEventId: GOOGLE_EVENT_ID,
					// externalCalendarId intentionally omitted
				} as ExportEventPayload, env as unknown as Bindings)
			).rejects.toThrow();

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when Google API returns a non-ok response', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 404,
				json: async () => ({ error: { message: 'Not Found' } }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({
					action: 'DELETE',
					externalEventId: GOOGLE_EVENT_ID,
					externalCalendarId: GOOGLE_CAL_ID,
				}), env as unknown as Bindings)
			).rejects.toThrow();

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 4. Token handling
	// ──────────────────────────────────────────────────────────────────────────
	describe('4. Token handling', () => {
		it('should use the cached access token when it is still valid', async () => {
			// Token expires far in the future (default seed)
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: GOOGLE_EVENT_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			// Only 1 fetch call — the Google API call, no token refresh
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
			expect(opts.headers).toEqual(
				expect.objectContaining({ Authorization: `Bearer ${ACCESS_TOKEN}` })
			);

			vi.restoreAllMocks();
		});

		it('should refresh the token when the access token is expired', async () => {
			// Re-seed OAuth with an expired access token
			await env.DB.prepare(
				`DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).run();
			await seedOAuthConnection({
				expires_at: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
			});

			const NEW_ACCESS_TOKEN = 'ya29.refreshed_token';
			const fetchSpy = vi.fn()
				// First call: token refresh
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: NEW_ACCESS_TOKEN,
						expires_in: 3600,
					}),
				})
				// Second call: Google Calendar API
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ id: GOOGLE_EVENT_ID }),
				});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			expect(fetchSpy).toHaveBeenCalledTimes(2);

			// First call should be the token refresh
			const [refreshUrl, refreshOpts] = fetchSpy.mock.calls[0] as [string, RequestInit];
			expect(refreshUrl).toBe('https://oauth2.googleapis.com/token');
			expect(refreshOpts.method).toBe('POST');
			const refreshBody = new URLSearchParams(refreshOpts.body as string);
			expect(refreshBody.get('grant_type')).toBe('refresh_token');
			expect(refreshBody.get('refresh_token')).toBe(REFRESH_TOKEN);

			// Second call should use the new token
			const [, apiOpts] = fetchSpy.mock.calls[1] as [string, RequestInit];
			expect(apiOpts.headers).toEqual(
				expect.objectContaining({ Authorization: `Bearer ${NEW_ACCESS_TOKEN}` })
			);

			// The new token should be persisted in D1
			const row = await env.DB.prepare(
				`SELECT access_token FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).first<{ access_token: string }>();
			expect(row?.access_token).toBe(NEW_ACCESS_TOKEN);

			vi.restoreAllMocks();
		});

		it('should throw when user has no OAuth connection', async () => {
			await env.DB.prepare(
				`DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).run();

			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings)
			).rejects.toThrow('User has no connected Google auth account');

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when refresh token is missing and access token is expired', async () => {
			await env.DB.prepare(
				`DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).run();
			await seedOAuthConnection({
				expires_at: Math.floor(Date.now() / 1000) - 3600,
				refresh_token: null,
			});

			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings)
			).rejects.toThrow('No refresh token available');

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should throw when the refresh token request fails', async () => {
			await env.DB.prepare(
				`DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).run();
			await seedOAuthConnection({
				expires_at: Math.floor(Date.now() / 1000) - 3600,
			});

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 401,
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings)
			).rejects.toThrow('Refresh token revoked or invalid');

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 5. Payload construction & edge cases
	// ──────────────────────────────────────────────────────────────────────────
	describe('5. Payload construction', () => {
		it('should convert event times to RFC 3339 / ISO 8601 with milliseconds', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'gcal-timestamp-test' }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			const body = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
			// Google requires dateTime in RFC 3339 format
			expect(body.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			expect(body.end.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

			// Verify the parsed times are correct
			expect(new Date(body.start.dateTime).toISOString()).toBe('2026-06-28T09:00:00.000Z');
			expect(new Date(body.end.dateTime).toISOString()).toBe('2026-06-28T09:30:00.000Z');

			vi.restoreAllMocks();
		});

		it('should map title to summary and description correctly', async () => {
			await env.DB.prepare(
				`UPDATE events SET title = 'Quarterly Review', description = 'Q2 metrics overview' WHERE id = ?`
			).bind(EVENT_ID).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'gcal-mapping-test' }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings);

			const body = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
			expect(body.summary).toBe('Quarterly Review');
			expect(body.description).toBe('Q2 metrics overview');

			vi.restoreAllMocks();
		});

		it('should send no body for DELETE requests', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true });
			vi.stubGlobal('fetch', fetchSpy);

			await exportGoogleEvents(makeJob({
				action: 'DELETE',
				externalEventId: GOOGLE_EVENT_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			}), env as unknown as Bindings);

			const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
			expect(opts.body).toBeUndefined();

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 6. Idempotency & state consistency
	// ──────────────────────────────────────────────────────────────────────────
	describe('6. Idempotency & state consistency', () => {
		it('should overwrite external_event_id on re-export if Google returns a new ID', async () => {
			// Seed event with an existing external_event_id
			await env.DB.prepare(
				`UPDATE events SET external_event_id = ? WHERE id = ?`
			).bind('old-gcal-id', EVENT_ID).run();

			const NEW_GOOGLE_ID = 'new-gcal-id';
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: NEW_GOOGLE_ID }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			// PUT without external_event_id forces a POST (create new on Google)
			// Clear it first
			await env.DB.prepare(
				`UPDATE events SET external_event_id = NULL WHERE id = ?`
			).bind(EVENT_ID).run();

			await exportGoogleEvents(makeJob({ action: 'PUT' }), env as unknown as Bindings);

			const after = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string }>();
			expect(after?.external_event_id).toBe(NEW_GOOGLE_ID);

			vi.restoreAllMocks();
		});

		it('should not modify external_event_id on failed Google API call', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 500,
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				exportGoogleEvents(makeJob({ action: 'POST' }), env as unknown as Bindings)
			).rejects.toThrow();

			const after = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE id = ?`
			).bind(EVENT_ID).first<{ external_event_id: string | null }>();
			expect(after?.external_event_id).toBeNull();

			vi.restoreAllMocks();
		});
	});
});
