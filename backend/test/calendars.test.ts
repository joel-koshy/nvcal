import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { sign } from 'hono/jwt';
import app from '../src/app';
import { applySchema } from './setup';

describe('NVCAL API Integration: Calendars & Constraints', () => {
	let authCookie: string;
	const TEST_USER_ID = 'usr_test_123';

	let calendarId: string;

	beforeEach(async () => {
		await applySchema();

		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
		const expiresAt = Math.floor(Date.now() / 1000) + 3600;
		const token = await sign({ sub: TEST_USER_ID, exp: expiresAt }, env.JWT_SECRET);

		authCookie = `nvcal_session=${token}`;
	});

	// CreateCalendarSchema requires name; every other column has a default.
	// Ownership (user_id) is inferred from the session, never the body.
	const FIXTURES = {
		work: {
			name: 'Work',
			color_hex: '#FF5733',
			timezone: 'America/New_York',
			is_external: 0
		},
		home: {
			name: 'Home'
		}
	};

	describe('0. Authentication & Security Guardrails', () => {
		it('should return 401 Unauthorized if no cookie is provided', async () => {
			const res = await app.request('/api/calendars', { method: 'GET' }, env);
			expect(res.status).toBe(401);
		});

		it('should return 401 Unauthorized if the cookie contains a tampered JWT', async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Cookie': 'nvcal_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid_payload.bad_signature'
				},
				body: JSON.stringify(FIXTURES.work)
			}, env);

			expect(res.status).toBe(401);
		});
	});

	describe('1. POST /api/calendars (Creation & Zod Boundaries)', () => {
		it('should create a calendar and materialize all defaults', async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(FIXTURES.home),
			}, env);

			const data = await res.json();
			if (res.status !== 201) console.error("Validation Error (home):", data);

			expect(res.status).toBe(201);
			expect(typeof data.calendar.id).toBe('string');
			// user_id is server-side only — never leaked to the client
			expect(data.calendar).not.toHaveProperty('user_id');
			expect(data.calendar.name).toBe('Home');
			expect(data.calendar.color_hex).toBe('#FFFFFF');
			expect(data.calendar.timezone).toBe('UTC');
			expect(data.calendar.is_external).toBe(0);
			expect(data.calendar.version).toBe(1);
			expect(data.calendar.external_provider).toBeNull();
			expect(data.calendar.external_calendar_id).toBeNull();
			expect(data.calendar.sync_token).toBeNull();
			expect(data.calendar.sync_channel_id).toBeNull();
			expect(data.calendar.sync_resource_id).toBeNull();

			calendarId = data.calendar.id;

			// Ownership is bound server-side: the row (not the response) carries it
			const dbRow = await env.DB.prepare('SELECT user_id FROM calendars WHERE id = ?').bind(calendarId).first();
			expect(dbRow!.user_id).toBe(TEST_USER_ID);
		});

		it('should respect explicit color and timezone values', async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(FIXTURES.work),
			}, env);

			const data = await res.json();
			expect(res.status).toBe(201);
			expect(data.calendar.color_hex).toBe('#FF5733');
			expect(data.calendar.timezone).toBe('America/New_York');
		});

		it('should reject completely empty payloads', async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify({}),
			}, env);

			expect(res.status).toBe(400);
		});

		it('should reject a missing or blank name', async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify({ name: '' }),
			}, env);

			expect(res.status).toBe(400);
		});

		it('should enforce boolean-integer limits on is_external (0 or 1 only)', async () => {
			const boundsErrorPayload = { ...FIXTURES.home, is_external: 2 };
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(boundsErrorPayload),
			}, env);

			expect(res.status).toBe(400);
		});

		it('should strip polluted payload fields to protect D1 schema', async () => {
			const pollutedPayload = {
				...FIXTURES.home,
				is_admin: true,
				drop_table: 'DROP TABLE calendars;'
			};

			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(pollutedPayload),
			}, env);

			const data = await res.json();
			if (res.status !== 201) console.error("Polluted Payload Error:", data);

			expect(res.status).toBe(201);
			expect(data.calendar).not.toHaveProperty('is_admin');
			expect(data.calendar).not.toHaveProperty('drop_table');
		});
	});

	describe('2. GET /api/calendars (List & Defaults) ', () => {
		beforeEach(async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(FIXTURES.work)
			}, env);
			calendarId = (await res.json()).calendar.id;
		});

		it('should list only calendars owned by the user with defaults materialized', async () => {
			const res = await app.request('/api/calendars', {
				headers: { 'Cookie': authCookie }
			}, env);

			const data = await res.json();
			if (res.status !== 200) console.error("GET Calendars Error:", data);

			expect(res.status).toBe(200);
			// setup.ts seeds calendar '1' for usr_test_123
			const seeded = data.calendars.find((c: any) => c.id === '1');
			expect(seeded).toBeDefined();
			expect(seeded.name).toBe('Test Calendar');
			expect(seeded.color_hex).toBe('#FFFFFF');
			expect(seeded.timezone).toBe('UTC');
			expect(seeded.is_external).toBe(0);
			expect(seeded.version).toBe(1);

			const created = data.calendars.find((c: any) => c.id === calendarId);
			expect(created).toBeDefined();
			expect(created.name).toBe('Work');
			expect(created.color_hex).toBe('#FF5733');
			expect(created.version).toBe(1);
		});
	});

	describe('3. PUT /api/calendars/:id (Optimistic Concurrency Control)', () => {
		beforeEach(async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(FIXTURES.home)
			}, env);
			calendarId = (await res.json()).calendar.id;
		});

		it('should update the calendar and increment version if versions match', async () => {
			const updatePayload = {
				...FIXTURES.home,
				name: 'Renamed Calendar',
				color_hex: '#00AAFF',
				version: 1
			};

			const res = await app.request(`/api/calendars/${calendarId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(updatePayload),
			}, env);

			const data = await res.json();
			if (res.status !== 200) console.error("PUT Update Error:", data);

			expect(res.status).toBe(200);
			expect(data.calendar.name).toBe('Renamed Calendar');
			expect(data.calendar.color_hex).toBe('#00AAFF');
			expect(data.calendar.version).toBe(2);
			// untouched fields persist
			expect(data.calendar.timezone).toBe('UTC');
			expect(data.calendar).not.toHaveProperty('user_id');
		});

		it('should never let an update reassign ownership', async () => {
			const res = await app.request(`/api/calendars/${calendarId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify({ name: 'Renamed Again', version: 1 }),
			}, env);

			expect(res.status).toBe(200);

			const dbRow = await env.DB.prepare('SELECT user_id FROM calendars WHERE id = ?').bind(calendarId).first();
			expect(dbRow!.user_id).toBe(TEST_USER_ID);
		});

		it('should handle multi-jump version gaps and return 409 Conflict (Stale Client)', async () => {
			await env.DB.prepare('UPDATE calendars SET version = 3 WHERE id = ?').bind(calendarId).run();

			const res = await app.request(`/api/calendars/${calendarId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				// Stale version = 1
				body: JSON.stringify({ ...FIXTURES.home, name: 'Stale UI Update', version: 1 }),
			}, env);

			const data = await res.json();
			if (res.status !== 409) console.error("Expected 409 Conflict, got:", data);

			expect(res.status).toBe(409);
			expect(data.error).toBe('Conflict');
			expect(data.currentState.version).toBe(3);
		});

		it('should return 404 when updating a calendar that does not exist', async () => {
			const res = await app.request('/api/calendars/nonexistent-id', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify({ ...FIXTURES.home, version: 1 }),
			}, env);

			expect(res.status).toBe(404);
		});
	});

	describe('4. DELETE /api/calendars/:id & Relational Integrity', () => {
		beforeEach(async () => {
			const res = await app.request('/api/calendars', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
				body: JSON.stringify(FIXTURES.home)
			}, env);
			calendarId = (await res.json()).calendar.id;
		});

		it('should require a version query parameter', async () => {
			const res = await app.request(`/api/calendars/${calendarId}`, {
				method: 'DELETE',
				headers: { 'Cookie': authCookie }
			}, env);

			expect(res.status).toBe(400);
		});

		it('should delete a calendar with a matching version', async () => {
			const res = await app.request(`/api/calendars/${calendarId}?version=1`, {
				method: 'DELETE',
				headers: { 'Cookie': authCookie }
			}, env);

			expect(res.status).toBe(204);

			const check = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId).all();
			expect(check.results.length).toBe(0);
		});

		it('should return 409 Conflict for a stale version', async () => {
			await env.DB.prepare('UPDATE calendars SET version = 2 WHERE id = ?').bind(calendarId).run();

			const res = await app.request(`/api/calendars/${calendarId}?version=1`, {
				method: 'DELETE',
				headers: { 'Cookie': authCookie }
			}, env);

			const data = await res.json();
			expect(res.status).toBe(409);
			expect(data.error).toBe('Conflict');
			expect(data.currentState.version).toBe(2);
		});

		it('should cascade-delete events that belong to the calendar', async () => {
			const eventId = crypto.randomUUID();
			await env.DB.prepare(
				`INSERT INTO events (id, calendar_id, title, start_time, end_time, is_all_day) VALUES (?, ?, ?, ?, ?, 0)`
			).bind(eventId, calendarId, 'Doomed Event', '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z').run();

			const res = await app.request(`/api/calendars/${calendarId}?version=1`, {
				method: 'DELETE',
				headers: { 'Cookie': authCookie }
			}, env);

			expect(res.status).toBe(204);

			const eventCheck = await env.DB.prepare('SELECT id FROM events WHERE calendar_id = ?').bind(calendarId).all();
			expect(eventCheck.results.length).toBe(0);
		});
	});
});

// ─── Ownership & Authorization Tests ──────────────────────────────────────────

describe('Ownership: cross-user calendar isolation', () => {
	let victimCookie: string;
	let attackerCookie: string;
	let victimCalendarId: string;

	const VICTIM_ID = 'usr_victim';
	const ATTACKER_ID = 'usr_attacker';

	beforeEach(async () => {
		await applySchema();
		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';

		await env.DB.prepare(
			`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`
		).bind(VICTIM_ID, 'victim@example.com', new Date().toISOString()).run();
		await env.DB.prepare(
			`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`
		).bind(ATTACKER_ID, 'attacker@example.com', new Date().toISOString()).run();

		const expiresAt = Math.floor(Date.now() / 1000) + 3600;
		const victimToken = await sign({ sub: VICTIM_ID, exp: expiresAt }, env.JWT_SECRET);
		const attackerToken = await sign({ sub: ATTACKER_ID, exp: expiresAt }, env.JWT_SECRET);
		victimCookie = `nvcal_session=${victimToken}`;
		attackerCookie = `nvcal_session=${attackerToken}`;

		const res = await app.request('/api/calendars', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Cookie': victimCookie },
			body: JSON.stringify({ name: 'Victim Private Cal' })
		}, env);
		victimCalendarId = (await res.json()).calendar.id;
	});

	it('should own the calendar to the session, never the body user_id', async () => {
		// Attacker claims Victim's user_id in the body — it is Zod-stripped,
		// and ownership is still bound to the session.
		const res = await app.request('/api/calendars', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Cookie': attackerCookie },
			body: JSON.stringify({ user_id: VICTIM_ID, name: 'Claimed Calendar' })
		}, env);

		const data = await res.json();
		expect(res.status).toBe(201);
		// user_id is a server-side column — the client never sees it
		expect(data.calendar).not.toHaveProperty('user_id');

		const dbCheck = await env.DB.prepare('SELECT user_id FROM calendars WHERE id = ?').bind(data.calendar.id).first();
		expect(dbCheck!.user_id).toBe(ATTACKER_ID);
	});

	it('should not return another users calendars in the list', async () => {
		const res = await app.request('/api/calendars', {
			headers: { 'Cookie': attackerCookie }
		}, env);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.calendars).toHaveLength(0);
		expect(data.calendars.find((c: any) => c.id === victimCalendarId)).toBeUndefined();
	});

	it('should return 404 when updating another user\'s calendar', async () => {
		const res = await app.request(`/api/calendars/${victimCalendarId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', 'Cookie': attackerCookie },
			body: JSON.stringify({ name: 'Hijacked Cal', version: 1 })
		}, env);

		expect(res.status).toBe(404);

		// Verify the calendar was NOT modified
		const check = await env.DB.prepare('SELECT name FROM calendars WHERE id = ?').bind(victimCalendarId).first();
		expect(check!.name).toBe('Victim Private Cal');
	});

	it('should return 404 when deleting another user\'s calendar', async () => {
		const res = await app.request(`/api/calendars/${victimCalendarId}?version=1`, {
			method: 'DELETE',
			headers: { 'Cookie': attackerCookie }
		}, env);

		expect(res.status).toBe(404);

		const check = await env.DB.prepare('SELECT id FROM calendars WHERE id = ?').bind(victimCalendarId).first();
		expect(check).toBeDefined();
	});
});