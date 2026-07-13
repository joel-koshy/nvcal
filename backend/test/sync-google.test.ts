import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { applySchema } from './setup';
import googleSyncRouter from '../src/routes/api/sync/google';
import { JobAction, Providers } from '../src/queue';
import type { Bindings, Variables } from '../src/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'usr_test_123';
const TEST_ACCESS_TOKEN = 'ya29.test_route_token';
const GOOGLE_CAL_ID_1 = 'primary@group.calendar.google.com';
const GOOGLE_CAL_ID_2 = 'secondary@group.calendar.google.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeAuthCookie(): Promise<string> {
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const token = await sign({ sub: TEST_USER_ID, exp: expiresAt }, env.JWT_SECRET || 'test_fallback_secret_key_123');
	return `nvcal_session=${token}`;
}

async function seedOAuthConnection() {
	await env.DB.prepare(
		`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
		 VALUES (?, ?, 'google', ?, ?, ?, ?)`
	).bind(
		'oc_route_test',
		TEST_USER_ID,
		'google-sub-route',
		TEST_ACCESS_TOKEN,
		'valid_refresh_token',
		Math.floor(Date.now() / 1000) + 3600
	).run();
}

// Wrapper app that injects the userId into context (simulates loadToken middleware)
function makeTestApp() {
	const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
	app.use('*', async (c, next) => {
		c.set('userId', TEST_USER_ID);
		await next();
	});
	app.route('/sync/google', googleSyncRouter);
	return app;
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const GOOGLE_CALENDAR_LIST_RESPONSE = {
	items: [
		{
			id: GOOGLE_CAL_ID_1,
			summary: 'Primary Calendar',
			description: 'My main calendar',
			backgroundColor: '#039BE5',
		},
		{
			id: GOOGLE_CAL_ID_2,
			summary: 'Work Calendar',
			backgroundColor: '#616161',
		},
	],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Route: GET /sync/google/calendars', () => {
	let app: ReturnType<typeof makeTestApp>;
	let authCookie: string;

	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
		authCookie = await makeAuthCookie();
		app = makeTestApp();
	});

	it('should return the list of Google calendars', async () => {
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => GOOGLE_CALENDAR_LIST_RESPONSE,
		});
		vi.stubGlobal('fetch', fetchSpy);

		const res = await app.request('/sync/google/calendars', {
			method: 'GET',
			headers: { Cookie: authCookie },
		}, env);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.calendars).toHaveLength(2);
		expect(data.calendars).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: GOOGLE_CAL_ID_1,
					name: 'Primary Calendar',
					description: 'My main calendar',
					color: '#039BE5',
				}),
				expect.objectContaining({
					id: GOOGLE_CAL_ID_2,
					name: 'Work Calendar',
					description: '',
				}),
			])
		);

		// Verify Google API was called correctly
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('googleapis.com/calendar/v3/users/me/calendarList');
		expect(opts.headers).toEqual(
			expect.objectContaining({ Authorization: `Bearer ${TEST_ACCESS_TOKEN}` })
		);

		vi.restoreAllMocks();
	});

	it('should return 500 if Google API fails', async () => {
		const fetchSpy = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 403,
		});
		vi.stubGlobal('fetch', fetchSpy);

		const res = await app.request('/sync/google/calendars', {
			method: 'GET',
			headers: { Cookie: authCookie },
		}, env);
		const data = await res.json();

		expect(res.status).toBe(500);
		expect(data.error).toBe('Failed to fetch Google calendars');

		vi.restoreAllMocks();
	});
});

describe('Route: POST /sync/google/import', () => {
	let app: ReturnType<typeof makeTestApp>;
	let authCookie: string;
	let sendSpy: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		await applySchema();
		await seedOAuthConnection();
		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
		authCookie = await makeAuthCookie();
		app = makeTestApp();

		sendSpy = vi.fn();
		env.SYNC_QUEUE = { send: sendSpy, get: vi.fn(), createBatch: vi.fn() } as any;
	});

	it('should create local calendar records and enqueue import jobs (returns 202)', async () => {
		const res = await app.request('/sync/google/import', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: authCookie,
			},
			body: JSON.stringify({
				googleCalendarIds: [GOOGLE_CAL_ID_1, GOOGLE_CAL_ID_2],
			}),
		}, env);

		expect(res.status).toBe(202);

		// ── Verify DB inserts ──────────────────────────────────────────
		const { results } = await env.DB.prepare(
			`SELECT external_calendar_id, external_provider
			 FROM calendars
			 WHERE user_id = ? AND external_provider = 'google'`
		).bind(TEST_USER_ID).all();

		expect(results.length).toBe(2);
		const externalIds = results.map(r => r.external_calendar_id);
		expect(externalIds).toContain(GOOGLE_CAL_ID_1);
		expect(externalIds).toContain(GOOGLE_CAL_ID_2);

		// ── Verify queue jobs were enqueued ────────────────────────────
		expect(sendSpy).toHaveBeenCalledTimes(2);

		const jobPayloads = sendSpy.mock.calls.map(
			(call: any[]) => call[0]
		);

		for (const job of jobPayloads) {
			expect(job.action).toBe(JobAction.IMPORT_CAL);
			expect(job.payload.provider).toBe(Providers.GOOGLE);
			expect(job.payload.userId).toBe(TEST_USER_ID);
			expect(job.payload.localCalendarId).toBeDefined();
			expect(job.payload.externalCalendarId).toBeDefined();
		}

		// Verify each enqueued job maps to one of the requested Google calendars
		const enqueuedExternalIds = jobPayloads.map(
			(j: any) => j.payload.externalCalendarId
		);
		expect(enqueuedExternalIds).toContain(GOOGLE_CAL_ID_1);
		expect(enqueuedExternalIds).toContain(GOOGLE_CAL_ID_2);
	});

	it('should reject empty googleCalendarIds array (Zod validation)', async () => {
		const res = await app.request('/sync/google/import', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: authCookie,
			},
			body: JSON.stringify({ googleCalendarIds: [] }),
		}, env);

		expect(res.status).toBe(400);
		expect(sendSpy).not.toHaveBeenCalled();
	});

	it('should reject missing googleCalendarIds field', async () => {
		const res = await app.request('/sync/google/import', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: authCookie,
			},
			body: JSON.stringify({}),
		}, env);

		expect(res.status).toBe(400);
		expect(sendSpy).not.toHaveBeenCalled();
	});

	it('should handle duplicate calendar IDs (dedup into calendars table)', async () => {
		const res = await app.request('/sync/google/import', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: authCookie,
			},
			body: JSON.stringify({
				googleCalendarIds: [GOOGLE_CAL_ID_1, GOOGLE_CAL_ID_1],
			}),
		}, env);

		expect(res.status).toBe(202);

		// DB deduplicates via ON CONFLICT, so only 1 calendar row
		const { results } = await env.DB.prepare(
			`SELECT external_calendar_id
			 FROM calendars
			 WHERE user_id = ? AND external_calendar_id = ?`
		).bind(TEST_USER_ID, GOOGLE_CAL_ID_1).all();
		expect(results.length).toBe(1);

		// But 2 jobs are still enqueued (one per requested ID)
		expect(sendSpy).toHaveBeenCalledTimes(2);
	});
});
