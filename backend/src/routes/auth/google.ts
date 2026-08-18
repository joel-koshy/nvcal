import { sign } from "hono/jwt";
import { setCookie } from "hono/cookie";
import { Hono } from "hono";

import type { Bindings } from "../../types";

const googleAuth = new Hono<{ Bindings: Bindings }>();

// redirect to google login - with access
googleAuth.get('/login', (c) => {
	const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
	const options = {
		redirect_uri: c.env.GOOGLE_REDIRECT_URI,
		client_id: c.env.GOOGLE_CLIENT_ID,
		access_type: 'offline',
		response_type: 'code',
		prompt: 'consent',       // refresh token
		scope: [
			'https://www.googleapis.com/auth/userinfo.email',
			'https://www.googleapis.com/auth/calendar.events',
			'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
		].join(' '),
	}
	const qs = new URLSearchParams(options).toString();
	return c.redirect(`${rootUrl}?${qs}`)
})

// call back from google
googleAuth.get('/callback', async (c) => {

	const code = c.req.query('code');
	if (!code) return c.json({ error: 'Authorization code missing' }, 400);

	// Retrieve Token
	const tokenUrl = 'https://oauth2.googleapis.com/token';
	const tokenRes = await fetch(tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: c.env.GOOGLE_CLIENT_ID,
			client_secret: c.env.GOOGLE_CLIENT_SECRET,
			redirect_uri: c.env.GOOGLE_REDIRECT_URI,
			grant_type: 'authorization_code',
		}),
	});

	if (!tokenRes.ok) return c.json({ error: 'Failed token exchange' }, 500);
	const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };

	const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
		headers: { Authorization: `Bearer ${tokens.access_token}` },
	});
	const googleUser = await userRes.json() as { email: string; id: string };

	// create/get user
	let user = await c.env.DB.prepare(
		`
		SELECT id FROM users
		WHERE email = ?
		`
	).bind(googleUser.email)
		.first<{ id: string }>();
	let userId = user?.id;
	if (!userId) {
		userId = crypto.randomUUID();
		// default calendar
		const defaultCalendarId = crypto.randomUUID();

		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO users (id, email, created_at)
				VALUES (?, ?, ?)`
			).bind(userId, googleUser.email, new Date().toISOString()),
			c.env.DB.prepare(
				`INSERT INTO calendars (id, user_id, name, is_external, external_provider)
				VALUES (?, ?, ?, 1, 'google')`
			).bind(defaultCalendarId, userId, 'Primary')
		]);
	}

	// Save Token
	const googleTokenExpiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
	await c.env.DB.prepare(
		`
		INSERT INTO oauth_connections (user_id, provider, provider_account_id, access_token, refresh_token, expires_at)
		VALUES (?, 'google', ?, ?, ?, ?)
		ON CONFLICT (user_id, provider) DO UPDATE SET
		access_token = excluded.access_token,
		expires_at = excluded.expires_at,
		refresh_token = COALESCE(excluded.refresh_token, oauth_connections.refresh_token)
		`
	).bind(userId, googleUser.id, tokens.access_token, tokens.refresh_token || null, googleTokenExpiresAt)
		.run();

	const maxAge = (7 * 24 * 60 * 60)
	const expAt = Math.floor(Date.now() / 1000) + maxAge; // 7 Days duration
	const payload = {
		sub: userId,
		exp: expAt,
	}
	const token = await sign(payload, c.env.JWT_SECRET);
	setCookie(c, 'nvcal_session', token, {
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		maxAge: maxAge,
		path: '/'
	})

	return c.redirect('/');
})

export default googleAuth;
