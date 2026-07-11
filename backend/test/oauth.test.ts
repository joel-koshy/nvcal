import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { getValidTokenGoogle } from '../src/util/oauth';

describe('Unit: getValidTokenGoogle', () => {
	const USER_ID = 'usr_test_123';
	const FRESH_TOKEN = 'ya29.access_token_fresh';
	const EXPIRED_TOKEN = 'ya29.access_token_expired';
	const REFRESHED_TOKEN = 'ya29.access_token_refreshed';

	beforeEach(async () => {
		await applySchema();

		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
		env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || 'test-client-id';
		env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || 'test-client-secret';
	});

	describe('1. Token already valid (not expired)', () => {
		it('should return the existing access_token without calling Google', async () => {
			// Seed a connection with a future expiry (1 hour from now)
			const expiresAt = Math.floor(Date.now() / 1000) + 3600;
			await env.DB.prepare(
				`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
				 VALUES (?, ?, 'google', ?, ?, ?, ?)`
			).bind('oc_fresh', USER_ID, 'google-sub-id', FRESH_TOKEN, 'refresh_token_val', expiresAt).run();

			const token = await getValidTokenGoogle(env, USER_ID);

			expect(token).toBe(FRESH_TOKEN);
		});
	});

	describe('2. Token expired — refresh flow', () => {
		it('should refresh and return the new token', async () => {
			// Seed a connection with an expired token
			const expiresAt = Math.floor(Date.now() / 1000) - 600;
			await env.DB.prepare(
				`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
				 VALUES (?, ?, 'google', ?, ?, ?, ?)`
			).bind('oc_expired', USER_ID, 'google-sub-id', EXPIRED_TOKEN, 'valid_refresh_token', expiresAt).run();

			// Mock the Google OAuth token endpoint
			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: REFRESHED_TOKEN,
					expires_in: 3600,
					token_type: 'Bearer',
				}),
			});
			vi.stubGlobal('fetch', fetchSpy);

			const token = await getValidTokenGoogle(env, USER_ID);

			expect(token).toBe(REFRESHED_TOKEN);
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://oauth2.googleapis.com/token');
			expect(opts.method).toBe('POST');

			// Verify the DB was updated with the new token
			const row = await env.DB.prepare(
				`SELECT access_token FROM oauth_connections WHERE user_id = ? AND provider = 'google'`
			).bind(USER_ID).first<{ access_token: string }>();
			expect(row!.access_token).toBe(REFRESHED_TOKEN);

			vi.restoreAllMocks();
		});
	});

	describe('3. Error: no oauth connection exists', () => {
		it('should throw if user has no Google auth row', async () => {
			await expect(
				getValidTokenGoogle(env, 'nonexistent_user')
			).rejects.toThrow('User has no connected Google auth account');
		});
	});

	describe('4. Error: expired token but no refresh_token', () => {
		it('should throw requesting re-authentication', async () => {
			const expiresAt = Math.floor(Date.now() / 1000) - 600;
			await env.DB.prepare(
				`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
				 VALUES (?, ?, 'google', ?, ?, ?, ?)`
			).bind('oc_no_refresh', USER_ID, 'google-sub-id', EXPIRED_TOKEN, null as any, expiresAt).run();

			await expect(
				getValidTokenGoogle(env, USER_ID)
			).rejects.toThrow('No refresh token available. User must re-authenticate with Google');
		});
	});

	describe('5. Error: Google refresh endpoint rejects', () => {
		it('should throw if the refresh token is revoked', async () => {
			const expiresAt = Math.floor(Date.now() / 1000) - 600;
			await env.DB.prepare(
				`INSERT INTO oauth_connections (id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
				 VALUES (?, ?, 'google', ?, ?, ?, ?)`
			).bind('oc_revoked', USER_ID, 'google-sub-id', EXPIRED_TOKEN, 'revoked_refresh', expiresAt).run();

			const fetchSpy = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 400,
				json: async () => ({ error: 'invalid_grant' }),
			});
			vi.stubGlobal('fetch', fetchSpy);

			await expect(
				getValidTokenGoogle(env, USER_ID)
			).rejects.toThrow('Refresh token revoked or invalid');

			vi.restoreAllMocks();
		});
	});
});
