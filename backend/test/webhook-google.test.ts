import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import googleWebhookRouter from '../src/routes/webhook/google';
import { setupGoogleWebhook, processGoogleWebhook } from '../src/queue/webhook/google';
import { importExternalCalendars } from '../src/queue/importCalendars';
import { JobAction, Providers, queueHandler, type ImportJobPayload } from '../src/queue';
import type { Bindings } from '../src/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'usr_test_123';
const TEST_CALENDAR_ID = 'local-cal-webhook';
const GOOGLE_CAL_ID = 'webhook-test@group.calendar.google.com';
const SYNC_TOKEN = 'initial-sync-token-abc';
const CHANNEL_ID = 'channel-uuid-123';

const APP_URL = 'https://nvcal.example.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedOAuthConnection() {
	await env.DB.prepare(
		`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
		 VALUES (?, ?, 'google', ?, ?, ?, ?)`
	).bind(
		'oc_webhook_test',
		TEST_USER_ID,
		'google-sub-webhook',
		'ya29.webhook_access_token',
		'valid_refresh_token',
		Math.floor(Date.now() / 1000) + 3600
	).run();
}

async function seedCalendar(overrides?: {
	sync_channel_id?: string;
	sync_token?: string | null;
	sync_resource_id?: string;
}) {
	await env.DB.prepare(
		`INSERT INTO calendars (id, user_id, name, timezone, is_external, external_calendar_id, sync_channel_id, sync_token, sync_resource_id)
		 VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
	).bind(
		TEST_CALENDAR_ID,
		TEST_USER_ID,
		'Webhook Test Calendar',
		'UTC',
		GOOGLE_CAL_ID,
		overrides?.sync_channel_id ?? 'pending-channel',
		overrides?.sync_token ?? SYNC_TOKEN,
		overrides?.sync_resource_id ?? 'pending-resource'
	).run();
}

async function getEventVersions(): Promise<Record<string, number>> {
	const { results } = await env.DB.prepare(
		`SELECT external_event_id, version FROM events WHERE calendar_id = ?`
	).bind(TEST_CALENDAR_ID).all<{ external_event_id: string; version: number }>();

	const map: Record<string, number> = {};
	for (const row of results) map[row.external_event_id] = row.version;
	return map;
}

async function getEventCount(): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT COUNT(*) as count FROM events WHERE calendar_id = ?`
	).bind(TEST_CALENDAR_ID).first<{ count: number }>();
	return results?.count ?? 0;
}

// ─── Tests: Route ─────────────────────────────────────────────────────────────

describe('Route: POST /webhooks/google', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		await seedCalendar({ sync_channel_id: CHANNEL_ID });
		env.APP_URL = APP_URL;
	});

	it('should return 200 OK immediately on sync verification', async () => {
		const sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

		const res = await googleWebhookRouter.fetch(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'x-goog-resource-state': 'sync',
					'x-goog-channel-id': 'should-be-ignored',
				},
			}),
			env
		);

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toBe('OK');

		expect(sendSpy).not.toHaveBeenCalled();
	});

	it('should enqueue PROCESS_GOOGLE_WEBHOOK when channel ID is provided', async () => {
		const sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

		const res = await googleWebhookRouter.fetch(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'x-goog-channel-id': CHANNEL_ID,
					'x-goog-resource-state': 'exists',
				},
			}),
			env
		);

		expect(res.status).toBe(200);
		expect(sendSpy).toHaveBeenCalledTimes(1);

		const enqueued = sendSpy.mock.calls[0][0];
		expect(enqueued.action).toBe(JobAction.PROCESS_WEBHOOK);
		expect(enqueued.payload).toEqual({
			provider: Providers.GOOGLE,
			channelId: CHANNEL_ID
		});
	});

	it('should return 200 OK without enqueueing when no channel ID', async () => {
		const sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

		const res = await googleWebhookRouter.fetch(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'x-goog-resource-state': 'exists',
				},
			}),
			env
		);

		expect(res.status).toBe(200);
		expect(sendSpy).not.toHaveBeenCalled();
	});

	it('should return 200 OK when no headers are present', async () => {
		const sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

		const res = await googleWebhookRouter.fetch(
			new Request('http://localhost/', {
				method: 'POST',
			}),
			env
		);

		expect(res.status).toBe(200);
		expect(sendSpy).not.toHaveBeenCalled();
	});
});

// ─── Integration: Route → queueHandler → processGoogleWebhook ─────────────────

describe('Integration: webhook route → queueHandler', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		await seedCalendar({ sync_channel_id: CHANNEL_ID });
		env.APP_URL = APP_URL;
		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	it('should correctly route enqueued message through queueHandler to processGoogleWebhook', async () => {
		// Mock Google Calendar API to return one event
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				items: [
					{
						id: 'gcal-integration-001',
						status: 'confirmed',
						summary: 'Integration Test Event',
						start: { dateTime: '2026-06-28T10:00:00Z' },
						end: { dateTime: '2026-06-28T11:00:00Z' },
					},
				],
				nextSyncToken: 'integration-sync-token',
			}),
		});
		vi.stubGlobal('fetch', fetchSpy);

		// 1. Send webhook via route
		const sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

		await googleWebhookRouter.fetch(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'x-goog-channel-id': CHANNEL_ID,
					'x-goog-resource-state': 'exists',
				},
			}),
			env
		);

		// 2. Capture what was enqueued
		expect(sendSpy).toHaveBeenCalledTimes(1);
		const enqueuedJob = sendSpy.mock.calls[0][0];

		// 3. Feed it through queueHandler (the actual dispatch)
		await queueHandler(enqueuedJob, env);

		// 4. Verify the event was actually written to DB
		const ev = await env.DB.prepare(
			`SELECT title, external_event_id FROM events WHERE calendar_id = ?`
		).bind(TEST_CALENDAR_ID).first<{ title: string; external_event_id: string }>();

		expect(ev).toBeDefined();
		expect(ev!.external_event_id).toBe('gcal-integration-001');
		expect(ev!.title).toBe('Integration Test Event');

		// 5. Verify sync_token was updated
		const cal = await env.DB.prepare(
			`SELECT sync_token FROM calendars WHERE id = ?`
		).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();
		expect(cal!.sync_token).toBe('integration-sync-token');

		vi.restoreAllMocks();
	});
});

// ─── Tests: setupGoogleWebhook ────────────────────────────────────────────────

describe('Queue: setupGoogleWebhook', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		await seedCalendar();
		env.APP_URL = APP_URL;
		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	it('should call Google Watch API and save sync_channel_id + sync_resource_id', async () => {
		const resourceId = 'google-resource-sync-001';
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ resourceId, kind: 'calendar#channel' }),
		});
		vi.stubGlobal('fetch', fetchSpy);

		await setupGoogleWebhook(
			{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: TEST_CALENDAR_ID },
			env
		);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('googleapis.com/calendar/v3/calendars/');
		expect(url).toContain('/events/watch');
		expect(url).toContain(encodeURIComponent(GOOGLE_CAL_ID));
		expect(opts.method).toBe('POST');

		const body = JSON.parse(opts.body as string);
		expect(body.type).toBe('web_hook');
		expect(body.address).toBe(`${APP_URL}/webhooks/google`);
		expect(body.id).toBeDefined();

		const cal = await env.DB.prepare(
			`SELECT sync_channel_id, sync_resource_id FROM calendars WHERE id = ?`
		).bind(TEST_CALENDAR_ID).first<{ sync_channel_id: string; sync_resource_id: string }>();

		expect(cal!.sync_channel_id).toBeDefined();
		expect(cal!.sync_channel_id).not.toBeNull();
		expect(cal!.sync_resource_id).toBe(resourceId);

		vi.restoreAllMocks();
	});

	it('should throw if the calendar does not exist', async () => {
		await expect(
			setupGoogleWebhook(
				{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: 'nonexistent-cal' },
				env
			)
		).rejects.toThrow('Calendar does not exist');
	});

	it('should throw if the user does not own the calendar', async () => {
		await env.DB.prepare(
			`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`
		).bind('usr_other', 'other@example.com', new Date().toISOString()).run();

		await env.DB.prepare(
			`INSERT INTO calendars (id, user_id, name, timezone, is_external, external_calendar_id)
			 VALUES (?, ?, ?, ?, 1, ?)`
		).bind('cal-other-user', 'usr_other', 'Other Cal', 'UTC', 'other@group.calendar.google.com').run();

		await expect(
			setupGoogleWebhook(
				{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: 'cal-other-user' },
				env
			)
		).rejects.toThrow('Calendar does not exist');
	});

	it('should throw if Google Watch API returns an error', async () => {
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: async () => ({ error: { message: 'Forbidden', code: 403 } }),
		});
		vi.stubGlobal('fetch', fetchSpy);

		await expect(
			setupGoogleWebhook(
				{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: TEST_CALENDAR_ID },
				env
			)
		).rejects.toThrow('Google Watch Failed');

		vi.restoreAllMocks();
	});

	it('should generate a unique sync_channel_id on each call', async () => {
		const fetchSpy = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ resourceId: 'res-1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ resourceId: 'res-2' }) });
		vi.stubGlobal('fetch', fetchSpy);

		await setupGoogleWebhook(
			{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: TEST_CALENDAR_ID },
			env
		);
		const firstChannelId = (await env.DB.prepare(
			`SELECT sync_channel_id FROM calendars WHERE id = ?`
		).bind(TEST_CALENDAR_ID).first())!.sync_channel_id;

		await setupGoogleWebhook(
			{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: TEST_CALENDAR_ID },
			env
		);
		const secondChannelId = (await env.DB.prepare(
			`SELECT sync_channel_id FROM calendars WHERE id = ?`
		).bind(TEST_CALENDAR_ID).first())!.sync_channel_id;

		expect(firstChannelId).not.toBe(secondChannelId);

		vi.restoreAllMocks();
	});

	it('should preserve existing sync_token when setting up webhook', async () => {
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ resourceId: 'res-preserve' }),
		});
		vi.stubGlobal('fetch', fetchSpy);

		await setupGoogleWebhook(
			{ userId: TEST_USER_ID, provider: Providers.GOOGLE, calendarId: TEST_CALENDAR_ID },
			env
		);

		const cal = await env.DB.prepare(
			`SELECT sync_token FROM calendars WHERE id = ?`
		).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();

		expect(cal!.sync_token).toBe(SYNC_TOKEN);

		vi.restoreAllMocks();
	});
});

// ─── Tests: processGoogleWebhook ──────────────────────────────────────────────

describe('Queue: processGoogleWebhook', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		await seedCalendar({ sync_channel_id: CHANNEL_ID });
		env.APP_URL = APP_URL;
		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	describe('1. Delta sync (normal webhook processing)', () => {
		it('should upsert new/changed events from Google delta response', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					nextSyncToken: 'new-sync-token-v2',
					items: [
						{
							id: 'gcal-delta-001',
							status: 'confirmed',
							summary: 'New Event from Webhook',
							description: 'Webhook triggered update',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
						{
							id: 'gcal-delta-002',
							status: 'confirmed',
							summary: 'All-Day Event',
							start: { date: '2026-06-28' },
							end: { date: '2026-06-29' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const { results } = await env.DB.prepare(
				`SELECT external_event_id, title, is_all_day, description
				 FROM events WHERE calendar_id = ?`
			).bind(TEST_CALENDAR_ID).all();

			expect(results).toHaveLength(2);

			const ev1 = results.find(r => r.external_event_id === 'gcal-delta-001');
			expect(ev1).toBeDefined();
			expect(ev1!.title).toBe('New Event from Webhook');
			expect(ev1!.description).toBe('Webhook triggered update');
			expect(ev1!.is_all_day).toBe(0);

			const ev2 = results.find(r => r.external_event_id === 'gcal-delta-002');
			expect(ev2).toBeDefined();
			expect(ev2!.title).toBe('All-Day Event');
			expect(ev2!.is_all_day).toBe(1);

			const cal = await env.DB.prepare(
				`SELECT sync_token FROM calendars WHERE id = ?`
			).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();
			expect(cal!.sync_token).toBe('new-sync-token-v2');

			vi.restoreAllMocks();
		});

		it('should delete events with status "cancelled"', async () => {
			await env.DB.prepare(
				`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
				 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
			).bind('existing-event', TEST_CALENDAR_ID, 'Will Be Cancelled', '2026-06-28T10:00:00Z', '2026-06-28T11:00:00Z', 'gcal-to-cancel').run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-to-cancel',
							status: 'cancelled',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const deleted = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-to-cancel').first();
			expect(deleted).toBeNull();

			vi.restoreAllMocks();
		});

		it('should fall back to "Untitled Event" when summary is missing', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-no-summary',
							status: 'confirmed',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const ev = await env.DB.prepare(
				`SELECT title FROM events WHERE external_event_id = ?`
			).bind('gcal-no-summary').first<{ title: string }>();
			expect(ev!.title).toBe('Untitled Event');

			vi.restoreAllMocks();
		});

		it('should handle empty items array (no changes)', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [],
					nextSyncToken: 'unchanged-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const { results } = await env.DB.prepare(
				`SELECT id FROM events WHERE calendar_id = ?`
			).bind(TEST_CALENDAR_ID).all();
			expect(results).toHaveLength(0);

			const cal = await env.DB.prepare(
				`SELECT sync_token FROM calendars WHERE id = ?`
			).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();
			expect(cal!.sync_token).toBe('unchanged-sync-token');

			vi.restoreAllMocks();
		});

		it('should keep existing sync_token when response has no nextSyncToken', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-no-next',
							status: 'confirmed',
							summary: 'Event',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const cal = await env.DB.prepare(
				`SELECT sync_token FROM calendars WHERE id = ?`
			).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();
			expect(cal!.sync_token).toBe(SYNC_TOKEN);

			vi.restoreAllMocks();
		});
	});

	describe('2. Calendar lookup edge cases', () => {
		it('should silently ignore webhook for unknown channel ID', async () => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: 'unknown-channel-id' },
				env
			);

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it('should silently ignore webhook when sync_token is null', async () => {
			await env.DB.prepare(
				`UPDATE calendars SET sync_token = NULL WHERE id = ?`
			).bind(TEST_CALENDAR_ID).run();

			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			expect(fetchSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});
	});

	describe('3. Sync token expiry (410 GONE)', () => {
		it('should clear sync_token and enqueue full re-import on 410', async () => {
			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: { message: 'Sync token no longer valid', code: 410 } }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const cal = await env.DB.prepare(
				`SELECT sync_token FROM calendars WHERE id = ?`
			).bind(TEST_CALENDAR_ID).first<{ sync_token: string | null }>();
			expect(cal!.sync_token).toBeNull();

			expect(sendSpy).toHaveBeenCalledTimes(1);
			const job = sendSpy.mock.calls[0][0];
			expect(job.action).toBe(JobAction.IMPORT_CAL);
			expect(job.payload.userId).toBe(TEST_USER_ID);
			expect(job.payload.localCalendarId).toBe(TEST_CALENDAR_ID);
			expect(job.payload.externalCalendarId).toBe(GOOGLE_CAL_ID);
			expect(job.payload.provider).toBe(Providers.GOOGLE);

			vi.restoreAllMocks();
		});

		it('should not delete existing events when handling 410', async () => {
			await env.DB.prepare(
				`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
				 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
			).bind('existing-evt', TEST_CALENDAR_ID, 'Pre-existing', '2026-06-28T10:00:00Z', '2026-06-28T11:00:00Z', 'gcal-pre-existing').run();

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: { code: 410 } }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const { results } = await env.DB.prepare(
				`SELECT id FROM events WHERE calendar_id = ?`
			).bind(TEST_CALENDAR_ID).all();
			expect(results).toHaveLength(1);

			vi.restoreAllMocks();
		});

		it('should handle re-import after 410 with no changes (empty Google response)', async () => {
			// Pre-seed 5 events to simulate existing state
			for (let i = 1; i <= 5; i++) {
				await env.DB.prepare(
					`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
					 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
				).bind(`evt-${i}`, TEST_CALENDAR_ID, `Event ${i}`, `2026-06-28T0${i}:00:00Z`, `2026-06-28T0${i}:30:00Z`, `gcal-event-${i}`).run();
			}

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			// 410 triggers re-import
			const fetchSpy410 = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: { code: 410 } }),
			});
			vi.stubGlobal('fetch', fetchSpy410);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Re-import returns same 5 events, no changes
			const importPayload = sendSpy.mock.calls[0][0].payload as ImportJobPayload;
			const fetchSpyImport = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-event-1', status: 'confirmed', summary: 'Event 1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
						{ id: 'gcal-event-2', status: 'confirmed', summary: 'Event 2', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
						{ id: 'gcal-event-3', status: 'confirmed', summary: 'Event 3', start: { dateTime: '2026-06-28T03:00:00Z' }, end: { dateTime: '2026-06-28T03:30:00Z' } },
						{ id: 'gcal-event-4', status: 'confirmed', summary: 'Event 4', start: { dateTime: '2026-06-28T04:00:00Z' }, end: { dateTime: '2026-06-28T04:30:00Z' } },
						{ id: 'gcal-event-5', status: 'confirmed', summary: 'Event 5', start: { dateTime: '2026-06-28T05:00:00Z' }, end: { dateTime: '2026-06-28T05:30:00Z' } },
					],
					nextSyncToken: 'post-reimport-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpyImport);

			await importExternalCalendars(importPayload, env);

			// Verify no version bumps (identical data)
			const versions = await getEventVersions();
			for (const [id, version] of Object.entries(versions)) {
				expect(version).toBe(1);
			}

			// Verify sync_token was set
			const cal = await env.DB.prepare(
				`SELECT sync_token FROM calendars WHERE id = ?`
			).bind(TEST_CALENDAR_ID).first<{ sync_token: string }>();
			expect(cal!.sync_token).toBe('post-reimport-sync-token');

			vi.restoreAllMocks();
		});

		it('should handle re-import after 410 with 1-2 changes', async () => {
			// Pre-seed 5 events
			for (let i = 1; i <= 5; i++) {
				await env.DB.prepare(
					`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
					 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
				).bind(`evt-${i}`, TEST_CALENDAR_ID, `Event ${i}`, `2026-06-28T0${i}:00:00Z`, `2026-06-28T0${i}:30:00Z`, `gcal-event-${i}`).run();
			}

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			// 410 triggers re-import
			const fetchSpy410 = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: { code: 410 } }),
			});
			vi.stubGlobal('fetch', fetchSpy410);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Re-import: events 2 and 4 have changed titles
			const importPayload = sendSpy.mock.calls[0][0].payload as ImportJobPayload;
			const fetchSpyImport = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-event-1', status: 'confirmed', summary: 'Event 1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
						{ id: 'gcal-event-2', status: 'confirmed', summary: 'Event 2 Updated', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
						{ id: 'gcal-event-3', status: 'confirmed', summary: 'Event 3', start: { dateTime: '2026-06-28T03:00:00Z' }, end: { dateTime: '2026-06-28T03:30:00Z' } },
						{ id: 'gcal-event-4', status: 'confirmed', summary: 'Event 4 Changed', start: { dateTime: '2026-06-28T04:00:00Z' }, end: { dateTime: '2026-06-28T04:30:00Z' } },
						{ id: 'gcal-event-5', status: 'confirmed', summary: 'Event 5', start: { dateTime: '2026-06-28T05:00:00Z' }, end: { dateTime: '2026-06-28T05:30:00Z' } },
					],
					nextSyncToken: 'post-reimport-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpyImport);

			await importExternalCalendars(importPayload, env);

			// Verify only changed events got version bumped
			const versions = await getEventVersions();
			expect(versions['gcal-event-1']).toBe(1); // unchanged
			expect(versions['gcal-event-2']).toBe(2); // changed
			expect(versions['gcal-event-3']).toBe(1); // unchanged
			expect(versions['gcal-event-4']).toBe(2); // changed
			expect(versions['gcal-event-5']).toBe(1); // unchanged

			vi.restoreAllMocks();
		});

		it('should handle re-import after 410 with one new event and one update', async () => {
			// Pre-seed 3 events
			for (let i = 1; i <= 3; i++) {
				await env.DB.prepare(
					`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
					 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
				).bind(`evt-${i}`, TEST_CALENDAR_ID, `Event ${i}`, `2026-06-28T0${i}:00:00Z`, `2026-06-28T0${i}:30:00Z`, `gcal-event-${i}`).run();
			}

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			// 410 triggers re-import
			const fetchSpy410 = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: { code: 410 } }),
			});
			vi.stubGlobal('fetch', fetchSpy410);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Re-import: event-2 updated, event-4 is new, cancelled events filtered out
			const importPayload = sendSpy.mock.calls[0][0].payload as ImportJobPayload;
			const fetchSpyImport = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-event-1', status: 'confirmed', summary: 'Event 1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
						{ id: 'gcal-event-2', status: 'confirmed', summary: 'Event 2 Updated', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
						{ id: 'gcal-event-3', status: 'confirmed', summary: 'Event 3', start: { dateTime: '2026-06-28T03:00:00Z' }, end: { dateTime: '2026-06-28T03:30:00Z' } },
						{ id: 'gcal-event-4', status: 'confirmed', summary: 'New Event 4', start: { dateTime: '2026-06-28T04:00:00Z' }, end: { dateTime: '2026-06-28T04:30:00Z' } },
					],
					nextSyncToken: 'post-reimport-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpyImport);

			await importExternalCalendars(importPayload, env);

			// Verify event-4 was created
			const created = await env.DB.prepare(
				`SELECT title FROM events WHERE external_event_id = ?`
			).bind('gcal-event-4').first<{ title: string }>();
			expect(created!.title).toBe('New Event 4');

			// Verify event-2 was updated (version bumped)
			const versions = await getEventVersions();
			expect(versions['gcal-event-2']).toBe(2);

			// Verify all 4 events exist (import filters cancelled, doesn't delete)
			const { results } = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE calendar_id = ?`
			).bind(TEST_CALENDAR_ID).all();
			expect(results).toHaveLength(4);

			vi.restoreAllMocks();
		});
	});

	describe('4. Description handling', () => {
		it('should set description to null when Google returns no description', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-no-desc',
							status: 'confirmed',
							summary: 'No Desc Event',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const ev = await env.DB.prepare(
				`SELECT description FROM events WHERE external_event_id = ?`
			).bind('gcal-no-desc').first<{ description: string | null }>();
			expect(ev!.description).toBeNull();

			vi.restoreAllMocks();
		});

		it('should preserve description on upsert when present', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-with-desc',
							status: 'confirmed',
							summary: 'With Desc Event',
							description: 'Some rich description',
							start: { dateTime: '2026-06-28T10:00:00Z' },
							end: { dateTime: '2026-06-28T11:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const ev = await env.DB.prepare(
				`SELECT description FROM events WHERE external_event_id = ?`
			).bind('gcal-with-desc').first<{ description: string }>();
			expect(ev!.description).toBe('Some rich description');

			vi.restoreAllMocks();
		});
	});

	describe('5. Upsert idempotency (no-op when data unchanged)', () => {
		it('should NOT increment version when webhook delivers same data', async () => {
			const googleResponse = {
				items: [
					{
						id: 'gcal-idempotent',
						status: 'confirmed',
						summary: 'Idempotent Event',
						start: { dateTime: '2026-06-28T10:00:00Z' },
						end: { dateTime: '2026-06-28T11:00:00Z' },
					},
				],
			};

			const fetchSpy = vi.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => googleResponse })
				.mockResolvedValueOnce({ ok: true, json: async () => googleResponse });
			vi.stubGlobal('fetch', fetchSpy);

			// First webhook — inserts with version 1
			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const ev1 = await env.DB.prepare(
				`SELECT version FROM events WHERE external_event_id = ?`
			).bind('gcal-idempotent').first<{ version: number }>();
			expect(ev1!.version).toBe(1);

			// Second webhook — same data, version should stay 1
			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const ev2 = await env.DB.prepare(
				`SELECT version FROM events WHERE external_event_id = ?`
			).bind('gcal-idempotent').first<{ version: number }>();
			expect(ev2!.version).toBe(1);

			// Should still be only 1 row
			const { results } = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-idempotent').all();
			expect(results).toHaveLength(1);

			vi.restoreAllMocks();
		});

		it('should increment version only when data actually changes', async () => {
			const responseV1 = {
				items: [
					{
						id: 'gcal-versioned',
						status: 'confirmed',
						summary: 'Version Test',
						start: { dateTime: '2026-06-28T10:00:00Z' },
						end: { dateTime: '2026-06-28T11:00:00Z' },
					},
				],
			};
			const responseV2 = {
				items: [
					{
						id: 'gcal-versioned',
						status: 'confirmed',
						summary: 'Version Test Updated', // changed
						start: { dateTime: '2026-06-28T10:00:00Z' },
						end: { dateTime: '2026-06-28T12:00:00Z' }, // changed
					},
				],
			};

			const fetchSpy = vi.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => responseV1 })
				.mockResolvedValueOnce({ ok: true, json: async () => responseV1 }) // same
				.mockResolvedValueOnce({ ok: true, json: async () => responseV2 }); // changed
			vi.stubGlobal('fetch', fetchSpy);

			// Insert v1
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			expect((await getEventVersions())['gcal-versioned']).toBe(1);

			// Same data — version stays 1
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			expect((await getEventVersions())['gcal-versioned']).toBe(1);

			// Changed data — version bumps to 2
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			expect((await getEventVersions())['gcal-versioned']).toBe(2);

			vi.restoreAllMocks();
		});
	});

	describe('6. Mixed batch (creates + deletes in one webhook)', () => {
		it('should process cancellations and upserts in the same batch', async () => {
			await env.DB.prepare(
				`INSERT INTO events (id, calendar_id, title, start_time, end_time, external_provider, external_event_id, version)
				 VALUES (?, ?, ?, ?, ?, 'google', ?, 1)`
			).bind('old-event', TEST_CALENDAR_ID, 'Old Event', '2026-06-28T08:00:00Z', '2026-06-28T09:00:00Z', 'gcal-cancel-me').run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							id: 'gcal-cancel-me',
							status: 'cancelled',
							start: { dateTime: '2026-06-28T08:00:00Z' },
							end: { dateTime: '2026-06-28T09:00:00Z' },
						},
						{
							id: 'gcal-new-event',
							status: 'confirmed',
							summary: 'Brand New',
							start: { dateTime: '2026-06-28T14:00:00Z' },
							end: { dateTime: '2026-06-28T15:00:00Z' },
						},
					],
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			const cancelled = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-cancel-me').first();
			expect(cancelled).toBeNull();

			const created = await env.DB.prepare(
				`SELECT title FROM events WHERE external_event_id = ?`
			).bind('gcal-new-event').first<{ title: string }>();
			expect(created!.title).toBe('Brand New');
		});
	});

	describe('7. Concurrency: import + webhook interleaving', () => {
		it('should handle webhook arriving mid-import (changes already processed by worker)', async () => {
			// Scenario: Import worker processes events 1-3, then webhook arrives with event-1 already imported
			const importPayload: ImportJobPayload = {
				provider: Providers.GOOGLE,
				userId: TEST_USER_ID,
				localCalendarId: TEST_CALENDAR_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			};

			// Import fetches events 1, 2, 3
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-concurrent-1', status: 'confirmed', summary: 'Event 1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
						{ id: 'gcal-concurrent-2', status: 'confirmed', summary: 'Event 2', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
						{ id: 'gcal-concurrent-3', status: 'confirmed', summary: 'Event 3', start: { dateTime: '2026-06-28T03:00:00Z' }, end: { dateTime: '2026-06-28T03:30:00Z' } },
					],
					nextSyncToken: 'import-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			// Import completes first
			await importExternalCalendars(importPayload, env);

			// Now webhook arrives with same event-1 (already imported)
			const webhookFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-concurrent-1', status: 'confirmed', summary: 'Event 1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
					],
					nextSyncToken: 'webhook-sync-token',
				}),
			});
			vi.stubGlobal('fetch', webhookFetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Event-1 should still have version 1 (no bump for same data)
			expect((await getEventVersions())['gcal-concurrent-1']).toBe(1);

			// All 3 events should still exist
			const { results } = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE calendar_id = ? ORDER BY external_event_id`
			).bind(TEST_CALENDAR_ID).all();
			expect(results).toHaveLength(3);

			vi.restoreAllMocks();
		});

		it('should handle webhook arriving mid-import (changes pending in worker queue)', async () => {
			// Scenario: Webhook fires first with event-1 update, then import worker processes full batch
			// The webhook arrives first
			const webhookFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-pending-1', status: 'confirmed', summary: 'Event 1 Webhook', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
					],
					nextSyncToken: 'webhook-sync-token',
				}),
			});
			vi.stubGlobal('fetch', webhookFetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Event-1 was created by webhook with version 1
			expect((await getEventVersions())['gcal-pending-1']).toBe(1);

			// Now import worker processes the full batch including same event-1
			const importPayload: ImportJobPayload = {
				provider: Providers.GOOGLE,
				userId: TEST_USER_ID,
				localCalendarId: TEST_CALENDAR_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			};

			const importFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-pending-1', status: 'confirmed', summary: 'Event 1 Webhook', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
						{ id: 'gcal-pending-2', status: 'confirmed', summary: 'Event 2 Import', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
					],
					nextSyncToken: 'import-sync-token',
				}),
			});
			vi.stubGlobal('fetch', importFetchSpy);

			await importExternalCalendars(importPayload, env);

			// Event-1: same data as webhook already set → no version bump
			expect((await getEventVersions())['gcal-pending-1']).toBe(1);
			// Event-2: new from import → version 1
			expect((await getEventVersions())['gcal-pending-2']).toBe(1);

			// Both events exist
			const { results } = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE calendar_id = ?`
			).bind(TEST_CALENDAR_ID).all();
			expect(results).toHaveLength(2);

			vi.restoreAllMocks();
		});

		it('should handle webhook with changes that import worker will also process', async () => {
			// Scenario: Import processes event-1, webhook updates event-1 mid-flight,
			// then import re-processes event-1 with OLD data (stale write)
			const importPayload: ImportJobPayload = {
				provider: Providers.GOOGLE,
				userId: TEST_USER_ID,
				localCalendarId: TEST_CALENDAR_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			};

			// Import fetches event-1 with original summary
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-stale-1', status: 'confirmed', summary: 'Original Summary', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
					],
					nextSyncToken: 'import-sync-token',
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await importExternalCalendars(importPayload, env);
			expect((await getEventVersions())['gcal-stale-1']).toBe(1);

			// Webhook arrives with UPDATED summary
			const webhookFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-stale-1', status: 'confirmed', summary: 'Webhook Updated Summary', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
					],
					nextSyncToken: 'webhook-sync-token',
				}),
			});
			vi.stubGlobal('fetch', webhookFetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Version should bump to 2 (webhook had different data)
			expect((await getEventVersions())['gcal-stale-1']).toBe(2);

			// Verify the title was updated
			const ev = await env.DB.prepare(
				`SELECT title FROM events WHERE external_event_id = ?`
			).bind('gcal-stale-1').first<{ title: string }>();
			expect(ev!.title).toBe('Webhook Updated Summary');

			vi.restoreAllMocks();
		});

		it('should handle rapid webhook burst (multiple webhooks for same calendar)', async () => {
			// Simulate rapid webhooks — each delivering partial updates
			const webhook1 = {
				items: [
					{ id: 'gcal-burst-1', status: 'confirmed', summary: 'Event 1 v1', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
				],
				nextSyncToken: 'burst-token-1',
			};
			const webhook2 = {
				items: [
					{ id: 'gcal-burst-1', status: 'confirmed', summary: 'Event 1 v2', start: { dateTime: '2026-06-28T01:00:00Z' }, end: { dateTime: '2026-06-28T01:30:00Z' } },
					{ id: 'gcal-burst-2', status: 'confirmed', summary: 'Event 2 v1', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
				],
				nextSyncToken: 'burst-token-2',
			};
			const webhook3 = {
				items: [
					{ id: 'gcal-burst-2', status: 'cancelled', start: { dateTime: '2026-06-28T02:00:00Z' }, end: { dateTime: '2026-06-28T02:30:00Z' } },
				],
				nextSyncToken: 'burst-token-3',
			};

			const fetchSpy = vi.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => webhook1 })
				.mockResolvedValueOnce({ ok: true, json: async () => webhook2 })
				.mockResolvedValueOnce({ ok: true, json: async () => webhook3 });
			vi.stubGlobal('fetch', fetchSpy);

			// Webhook 1: creates event-1
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			expect((await getEventVersions())['gcal-burst-1']).toBe(1);

			// Webhook 2: updates event-1, creates event-2
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			expect((await getEventVersions())['gcal-burst-1']).toBe(2);
			expect((await getEventVersions())['gcal-burst-2']).toBe(1);

			// Webhook 3: deletes event-2
			await processGoogleWebhook({ provider: Providers.GOOGLE, channelId: CHANNEL_ID }, env);
			const deleted = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-burst-2').first();
			expect(deleted).toBeNull();

			// Event-1 should still exist with version 2
			const ev1 = await env.DB.prepare(
				`SELECT title, version FROM events WHERE external_event_id = ?`
			).bind('gcal-burst-1').first<{ title: string; version: number }>();
			expect(ev1!.title).toBe('Event 1 v2');
			expect(ev1!.version).toBe(2);

			vi.restoreAllMocks();
		});

		it('should handle webhook-created event surviving import (import filters cancelled, does not delete)', async () => {
			// Webhook creates event, then import arrives with that event as cancelled.
			// Import filters OUT cancelled events but does not delete existing ones —
			// only webhooks handle deletion.

			// Step 1: Webhook creates event
			const webhookFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-will-survive', status: 'confirmed', summary: 'Temporary Event', start: { dateTime: '2026-06-28T10:00:00Z' }, end: { dateTime: '2026-06-28T11:00:00Z' } },
					],
					nextSyncToken: 'webhook-token',
				}),
			});
			vi.stubGlobal('fetch', webhookFetchSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// Event exists
			const ev = await env.DB.prepare(
				`SELECT title FROM events WHERE external_event_id = ?`
			).bind('gcal-will-survive').first();
			expect(ev).toBeDefined();

			// Step 2: Import arrives — cancelled events are filtered out, not deleted
			const importPayload: ImportJobPayload = {
				provider: Providers.GOOGLE,
				userId: TEST_USER_ID,
				localCalendarId: TEST_CALENDAR_ID,
				externalCalendarId: GOOGLE_CAL_ID,
			};

			const importFetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-will-survive', status: 'cancelled', start: { dateTime: '2026-06-28T10:00:00Z' }, end: { dateTime: '2026-06-28T11:00:00Z' } },
					],
					nextSyncToken: 'import-token',
				}),
			});
			vi.stubGlobal('fetch', importFetchSpy);

			await importExternalCalendars(importPayload, env);

			// Event still exists — import only filters, doesn't delete
			const survived = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-will-survive').first();
			expect(survived).toBeDefined();

			// Step 3: Only a webhook can delete it
			const deleteWebhookSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'gcal-will-survive', status: 'cancelled', start: { dateTime: '2026-06-28T10:00:00Z' }, end: { dateTime: '2026-06-28T11:00:00Z' } },
					],
					nextSyncToken: 'delete-token',
				}),
			});
			vi.stubGlobal('fetch', deleteWebhookSpy);

			await processGoogleWebhook(
				{ provider: Providers.GOOGLE, channelId: CHANNEL_ID },
				env
			);

			// NOW it's deleted
			const deleted = await env.DB.prepare(
				`SELECT id FROM events WHERE external_event_id = ?`
			).bind('gcal-will-survive').first();
			expect(deleted).toBeNull();

			vi.restoreAllMocks();
		});
	});
});
