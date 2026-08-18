import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { importExternalCalendars } from '../src/queue/importCalendars';
import { JobAction, Providers, type ImportJobPayload } from '../src/queue';

// ─── Test Data ────────────────────────────────────────────────────────────────

const VALID_USER_ID = 'usr_test_123';
const LOCAL_CAL_ID = 'local-cal-uuid';
const GOOGLE_CAL_ID = 'calendar-id@group.calendar.google.com';

const BASE_PAYLOAD: ImportJobPayload = {
	provider: Providers.GOOGLE,
	userId: VALID_USER_ID,
	localCalendarId: LOCAL_CAL_ID,
	externalCalendarId: GOOGLE_CAL_ID,
};

// Single-page response with nextSyncToken (happy path)
const GOOGLE_EVENTS_RESPONSE = {
	items: [
		{
			id: 'gcal-event-001',
			summary: 'Team Standup',
			status: 'confirmed',
			start: { dateTime: '2026-06-28T09:00:00Z' },
			end: { dateTime: '2026-06-28T09:30:00Z' },
		},
		{
			id: 'gcal-event-002',
			summary: 'Lunch Break',
			status: 'confirmed',
			start: { date: '2026-06-28' },
			end: { date: '2026-06-29' },
		},
		{
			id: 'gcal-event-cancelled',
			summary: 'Cancelled Meeting',
			status: 'cancelled',
			start: { dateTime: '2026-06-28T14:00:00Z' },
			end: { dateTime: '2026-06-28T15:00:00Z' },
		},
		{
			id: 'gcal-event-untitled',
			// summary intentionally missing
			status: 'confirmed',
			start: { dateTime: '2026-06-28T16:00:00Z' },
			end: { dateTime: '2026-06-28T17:00:00Z' },
		},
	],
	nextSyncToken: 'sync-token-final-v1',
};

// Single-page response with NO tokens (fatal error case)
const GOOGLE_EVENTS_NO_TOKENS = {
	items: [
		{
			id: 'gcal-orphan-event',
			summary: 'Orphan Event',
			status: 'confirmed',
			start: { dateTime: '2026-06-28T09:00:00Z' },
			end: { dateTime: '2026-06-28T09:30:00Z' },
		},
	],
	// No nextPageToken, no nextSyncToken
};

// Paginated: page 1 (has nextPageToken, no syncToken)
const GOOGLE_EVENTS_PAGE1 = {
	items: [
		{
			id: 'gcal-page1-event',
			summary: 'Page 1 Event',
			status: 'confirmed',
			start: { dateTime: '2026-06-28T10:00:00Z' },
			end: { dateTime: '2026-06-28T11:00:00Z' },
		},
	],
	nextPageToken: 'next-page-token-abc',
};

// Paginated: page 2 final (has nextSyncToken, no nextPageToken)
const GOOGLE_EVENTS_PAGE2 = {
	items: [
		{
			id: 'gcal-page2-event',
			summary: 'Page 2 Event',
			status: 'confirmed',
			start: { dateTime: '2026-06-28T12:00:00Z' },
			end: { dateTime: '2026-06-28T13:00:00Z' },
		},
	],
	nextSyncToken: 'sync-token-after-pagination',
};

// Response with changed event data (for version-increment test)
const GOOGLE_EVENTS_CHANGED = {
	items: [
		{
			id: 'gcal-event-001',
			summary: 'Team Standup — Updated', // changed title
			status: 'confirmed',
			start: { dateTime: '2026-06-28T09:15:00Z' }, // changed start
			end: { dateTime: '2026-06-28T09:45:00Z' },   // changed end
		},
		{
			id: 'gcal-event-002',
			summary: 'Lunch Break',
			status: 'confirmed',
			start: { date: '2026-06-28' },
			end: { date: '2026-06-29' },
		},
	],
	nextSyncToken: 'sync-token-changed-v2',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedOAuthConnection(overrides?: { expires_at?: number; refresh_token?: string | null }) {
	const expiresAt = overrides?.expires_at ?? Math.floor(Date.now() / 1000) + 3600;
	return env.DB.prepare(
		`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
		 VALUES (?, ?, 'google', ?, ?, ?, ?)`
	).bind(
		'oc_import_test',
		VALID_USER_ID,
		'google-sub-import',
		'ya29.valid_access_token',
		overrides?.refresh_token ?? 'valid_refresh_token',
		expiresAt
	).run();
}

async function getEventVersions(): Promise<Record<string, number>> {
	const { results } = await env.DB.prepare(
		`SELECT external_event_id, version FROM events WHERE calendar_id = ?`
	).bind(LOCAL_CAL_ID).all<{ external_event_id: string; version: number }>();

	const map: Record<string, number> = {};
	for (const row of results) map[row.external_event_id] = row.version;
	return map;
}

async function getSyncToken(): Promise<string | null> {
	const row = await env.DB.prepare(
		`SELECT sync_token FROM calendars WHERE id = ?`
	).bind(LOCAL_CAL_ID).first<{ sync_token: string | null }>();
	return row?.sync_token ?? null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Queue: importExternalCalendars (Google)', () => {
	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();

		// Seed the calendar that importCalendars will reference via payload.localCalendarId
		await env.DB.prepare(
			`INSERT INTO calendars (id, user_id, name, timezone, is_external)
			 VALUES (?, ?, ?, ?, 1)`
		).bind(LOCAL_CAL_ID, VALID_USER_ID, 'Google Import Target', 'UTC').run();

		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 1. Single-page import
	// ──────────────────────────────────────────────────────────────────────────
	describe('1. Single page import', () => {
		it('should insert confirmed events, filter cancelled, and save sync_token', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			await importExternalCalendars(BASE_PAYLOAD, env);

			// ── Verify DB inserts ────────────────────────────────────────
			const { results } = await env.DB.prepare(
				`SELECT external_event_id, title
				 FROM events
				 WHERE calendar_id = ?`
			).bind(LOCAL_CAL_ID).all();

			// 3 confirmed events (cancelled filtered out)
			expect(results.length).toBe(3);

			const ids = results.map(r => r.external_event_id);
			expect(ids).toContain('gcal-event-001');
			expect(ids).toContain('gcal-event-002');
			expect(ids).toContain('gcal-event-untitled');
			expect(ids).not.toContain('gcal-event-cancelled');

			const titles = results.map(r => r.title);
			expect(titles).toContain('Team Standup');
			expect(titles).toContain('Lunch Break');
			expect(titles).toContain('Untitled');

			// ── Verify sync_token was saved ──────────────────────────────
			const syncToken = await getSyncToken();
			expect(syncToken).toBe('sync-token-final-v1');

			// ── Verify SETUP_WEBHOOK_WATCH was enqueued ──────────────────
			expect(sendSpy).toHaveBeenCalledTimes(1);
			const job = sendSpy.mock.calls[0][0];
			expect(job.action).toBe(JobAction.SETUP_WEBHOOK_WATCH);
			expect(job.payload.userId).toBe(VALID_USER_ID);
			expect(job.payload.provider).toBe(Providers.GOOGLE);
			expect(job.payload.calendarId).toBe(LOCAL_CAL_ID);

			// ── Verify Google API call ───────────────────────────────────
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
			expect(url).toContain('googleapis.com/calendar/v3/calendars/');
			expect(url).toContain('singleEvents=true');
			expect(url).toContain('maxResults=100');
			expect(url).toContain('nextSyncToken');
			expect(opts.headers).toEqual(
				expect.objectContaining({ Authorization: 'Bearer ya29.valid_access_token' })
			);

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 2. Paginated import
	// ──────────────────────────────────────────────────────────────────────────
	describe('2. Paginated import', () => {
		it('should process page 1 and enqueue IMPORT_CAL for page 2', async () => {
			const fetchSpy = vi.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => GOOGLE_EVENTS_PAGE1 })
				.mockResolvedValueOnce({ ok: true, json: async () => GOOGLE_EVENTS_PAGE2 });
			vi.stubGlobal('fetch', fetchSpy);

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			await importExternalCalendars(BASE_PAYLOAD, env);

			// Page 1 events were inserted
			const { results } = await env.DB.prepare(
				`SELECT external_event_id FROM events WHERE calendar_id = ?`
			).bind(LOCAL_CAL_ID).all();
			expect(results).toHaveLength(1);
			expect(results[0].external_event_id).toBe('gcal-page1-event');

			// Page 2 was enqueued (not webhook watch yet)
			expect(sendSpy).toHaveBeenCalledTimes(1);
			const enqueuedJob = sendSpy.mock.calls[0][0];
			expect(enqueuedJob.action).toBe(JobAction.IMPORT_CAL);
			expect(enqueuedJob.payload.pageToken).toBe('next-page-token-abc');

			vi.restoreAllMocks();
		});

		it('should save sync_token and send SETUP_WEBHOOK_WATCH after the final page', async () => {
			const fetchSpy = vi.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => GOOGLE_EVENTS_PAGE1 })
				.mockResolvedValueOnce({ ok: true, json: async () => GOOGLE_EVENTS_PAGE2 });
			vi.stubGlobal('fetch', fetchSpy);

			const sendSpy = vi.fn();
			env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;

			// Process page 1 → enqueues page 2
			await importExternalCalendars(BASE_PAYLOAD, env);
			const page2Job = sendSpy.mock.calls[0][0];

			// Process page 2 → should save sync_token + enqueue webhook watch
			sendSpy.mockClear();
			await importExternalCalendars(page2Job.payload, env);

			expect(sendSpy).toHaveBeenCalledTimes(1);
			const webhookJob = sendSpy.mock.calls[0][0];
			expect(webhookJob.action).toBe(JobAction.SETUP_WEBHOOK_WATCH);
			expect(webhookJob.payload.userId).toBe(VALID_USER_ID);
			expect(webhookJob.payload.provider).toBe(Providers.GOOGLE);
			expect(webhookJob.payload.calendarId).toBe(LOCAL_CAL_ID);

			// Verify sync_token was persisted
			const syncToken = await getSyncToken();
			expect(syncToken).toBe('sync-token-after-pagination');

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 3. Sync token handling
	// ──────────────────────────────────────────────────────────────────────────
	describe('3. Sync token handling', () => {
		it('should save nextSyncToken to calendars.sync_token', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);
			env.SYNC_QUEUE = { send: vi.fn(), get: vi.fn(), createBatch: vi.fn() } as any;

			// Initially null
			expect(await getSyncToken()).toBeNull();

			await importExternalCalendars(BASE_PAYLOAD, env);

			expect(await getSyncToken()).toBe('sync-token-final-v1');

			vi.restoreAllMocks();
		});

		it('should overwrite an existing sync_token with the latest value', async () => {
			// Seed an old sync_token
			await env.DB.prepare(
				`UPDATE calendars SET sync_token = ? WHERE id = ?`
			).bind('old-sync-token', LOCAL_CAL_ID).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);
			env.SYNC_QUEUE = { send: vi.fn(), get: vi.fn(), createBatch: vi.fn() } as any;

			await importExternalCalendars(BASE_PAYLOAD, env);

			expect(await getSyncToken()).toBe('sync-token-final-v1');

			vi.restoreAllMocks();
		});

		it('should throw if Google returns neither nextPageToken nor nextSyncToken', async () => {
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_NO_TOKENS,
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				importExternalCalendars(BASE_PAYLOAD, env)
			).rejects.toThrow('Fatal: Google returned no pagination or sync tokens.');

			// sync_token should remain null
			expect(await getSyncToken()).toBeNull();

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 4. Upsert semantics — conditional version increment
	// ──────────────────────────────────────────────────────────────────────────
	describe('4. Upsert semantics (conditional version increment)', () => {
		it('should NOT increment version when re-importing identical data', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);
			env.SYNC_QUEUE = { send: vi.fn(), get: vi.fn(), createBatch: vi.fn() } as any;

			// First import — inserts with version = 1
			await importExternalCalendars(BASE_PAYLOAD, env);
			const afterFirst = await getEventVersions();
			expect(afterFirst['gcal-event-001']).toBe(1);
			expect(afterFirst['gcal-event-002']).toBe(1);

			// Second import — identical data, WHERE clause should prevent update
			await importExternalCalendars(BASE_PAYLOAD, env);
			const afterSecond = await getEventVersions();

			// Version should remain 1 (no unnecessary bump)
			expect(afterSecond['gcal-event-001']).toBe(1);
			expect(afterSecond['gcal-event-002']).toBe(1);

			vi.restoreAllMocks();
		});

		it('should increment version when event data has changed', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);
			env.SYNC_QUEUE = { send: vi.fn(), get: vi.fn(), createBatch: vi.fn() } as any;

			// First import
			await importExternalCalendars(BASE_PAYLOAD, env);
			const afterFirst = await getEventVersions();
			expect(afterFirst['gcal-event-001']).toBe(1);
			expect(afterFirst['gcal-event-002']).toBe(1);

			// Second import with changed data for event-001 only
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_CHANGED,
			});

			await importExternalCalendars(BASE_PAYLOAD, env);
			const afterSecond = await getEventVersions();

			// event-001 title + times changed → version bumped to 2
			expect(afterSecond['gcal-event-001']).toBe(2);
			// event-002 unchanged → version stays at 1
			expect(afterSecond['gcal-event-002']).toBe(1);

			vi.restoreAllMocks();
		});

		it('should handle initial insert (version = 1) and only increment on actual changes', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => GOOGLE_EVENTS_RESPONSE,
			});
			vi.stubGlobal('fetch', fetchSpy);
			env.SYNC_QUEUE = { send: vi.fn(), get: vi.fn(), createBatch: vi.fn() } as any;

			// First import — INSERT, version = 1
			await importExternalCalendars(BASE_PAYLOAD, env);
			expect((await getEventVersions())['gcal-event-001']).toBe(1);

			// Re-import identical — no change, version stays 1
			await importExternalCalendars(BASE_PAYLOAD, env);
			expect((await getEventVersions())['gcal-event-001']).toBe(1);

			// Re-import with change — UPDATE, version = 2
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_CHANGED,
			});
			await importExternalCalendars(BASE_PAYLOAD, env);
			expect((await getEventVersions())['gcal-event-001']).toBe(2);

			// Re-import the changed version again — no change, version stays 2
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => GOOGLE_EVENTS_CHANGED,
			});
			await importExternalCalendars(BASE_PAYLOAD, env);
			expect((await getEventVersions())['gcal-event-001']).toBe(2);

			vi.restoreAllMocks();
		});
	});

	// ──────────────────────────────────────────────────────────────────────────
	// 5. Error handling
	// ──────────────────────────────────────────────────────────────────────────
	describe('5. Error handling', () => {
		it('should propagate the error when getValidTokenGoogle fails', async () => {
			await env.DB.prepare(
				`DELETE FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(VALID_USER_ID).run();

			await expect(
				importExternalCalendars(BASE_PAYLOAD, env)
			).rejects.toThrow('User has no connected Google auth account');
		});
	});
});
