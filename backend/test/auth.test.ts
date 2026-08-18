import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers'; // Ensure this matches your vitest config
import app from '../src/app';
import { applySchema } from './setup';

describe('NVCAL API Integration: Authentication Flow', () => {
	beforeEach(async () => {
		await applySchema();
		// Ensure the environment secret exists for signing the JWT
		env.JWT_SECRET = env.JWT_SECRET || 'test_fallback_secret_key_123';
	});

	const VALID_CREDENTIALS = {
		email: 'joel@nvcal.local',
		password: 'SuperSecurePassword123!'
	};

	describe('1. POST /auth/signup', () => {
		it('should successfully create a new user and issue a secure cookie', async () => {
			const res = await app.request('/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(VALID_CREDENTIALS),
			}, env);

			expect(res.status).toBe(201);

			const data = await res.json();
			expect(data.success).toBe(true);
			expect(data.user_id).toBeDefined();

			// VERIFY SECURITY: Assert the Set-Cookie header contains all required flags
			const cookieHeader = res.headers.get('Set-Cookie');
			expect(cookieHeader).toBeDefined();
			expect(cookieHeader).toContain('nvcal_session=');
			expect(cookieHeader).toContain('HttpOnly');
			expect(cookieHeader).toContain('Secure');
			expect(cookieHeader).toContain('SameSite=Strict');
		});

		it('should reject signup if the password is too short (Zod Validation)', async () => {
			const res = await app.request('/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'joel2@nvcal.local',
					password: 'short' // Below the 8 char minimum
				}),
			}, env);

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toContain('Password must be at least 8 characters');
		});

		it('should return 409 Conflict if attempting to sign up with an existing email', async () => {
			// 1. Initial Signup
			await app.request('/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(VALID_CREDENTIALS),
			}, env);

			// 2. Duplicate Signup Attempt
			const res = await app.request('/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(VALID_CREDENTIALS),
			}, env);

			expect(res.status).toBe(409);
			const data = await res.json();
			expect(data.error).toBe('Email already in use');
		});
	});

	describe('2. POST /auth/login', () => {
		beforeEach(async () => {
			// Pre-seed a valid user for the login tests to execute against
			const seedres = await app.request('/auth/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(VALID_CREDENTIALS),
			}, env);
			expect(seedres.status).toBe(201);
		});

		it('should successfully log in and issue a new session cookie', async () => {
			const res = await app.request('/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(VALID_CREDENTIALS),
			}, env);

			expect(res.status).toBe(200);

			const data = await res.json();
			expect(data.success).toBe(true);

			// Assert cookie issuance on login
			const cookieHeader = res.headers.get('Set-Cookie');
			expect(cookieHeader).toContain('nvcal_session=');
		});

		it('should reject login with a 401 if the password does not match', async () => {
			const res = await app.request('/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: VALID_CREDENTIALS.email,
					password: 'WrongPassword123!'
				}),
			}, env);

			expect(res.status).toBe(401);
			const data = await res.json();

			// Security Best Practice: Never reveal *which* part of the credentials failed
			expect(data.error).toBe('Invalid Credentials');
		});

		it('should reject login with a 401 if the email does not exist', async () => {
			const res = await app.request('/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'ghost@nvcal.local',
					password: VALID_CREDENTIALS.password
				}),
			}, env);

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.error).toBe('Invalid Credentials');
		});
	});
});
