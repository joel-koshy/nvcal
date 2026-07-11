import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../util/crypto';
import type { Bindings } from '../../types';
import googleAuth from './google';

const authRouter = new Hono<{ Bindings: Bindings }>();
authRouter.route('/google', googleAuth)


const CredentialsSchema = z.object({
	email: z.email(),
	password: z.string().min(8, "Password must be at least 8 characters"),
})
authRouter.post("/signup", async (c) => {
	const body = await c.req.json();
	const parsed = CredentialsSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({
			error: parsed.error.issues.map(i => i.message).join(', '),
		}, 400);
	}
	const { email, password } = parsed.data;

	const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
		.bind(email).first();
	if (existingUser) {
		return c.json({
			error: "Email already in use"
		}, 409);
	}

	const hashedPassword = await hashPassword(password);
	const userId = crypto.randomUUID();
	const now = new Date().toISOString();

	await c.env.DB
		.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
		.bind(userId, email, hashedPassword, now)
		.run();

	// Return Login Token
	const maxAge = 60 * 60 * 24 * 30 // 30 Day Expiration
	const expiresAt = Math.floor(Date.now() / 1000) + maxAge
	const payload = {
		sub: userId,
		exp: expiresAt,
	}
	const token = await sign(payload, c.env.JWT_SECRET);
	setCookie(c, 'nvcal_session', token, {
		httpOnly: true,
		secure: true,
		sameSite: 'Strict',
		maxAge: maxAge,
		path: '/'
	})

	return c.json({ success: true, user_id: userId }, 201);
})


authRouter.post("/login", async (c) => {
	const body = await c.req.json();
	const parsed = CredentialsSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({
			error: "Invalid Payload",
		}, 400)
	}

	const user: any = await c.env.DB
		.prepare("SELECT * FROM users WHERE email = ?")
		.bind(parsed.data.email)
		.first();
	if (!user) {
		return c.json({
			error: "Invalid Credentials",
		}, 401);
	}

	const isValid = await verifyPassword(parsed.data.password, user.password_hash);
	if (!isValid) {
		return c.json({
			error: "Invalid Credentials",
		}, 401);
	}

	// Generate Cookie
	const maxAge = 60 * 60 * 24 * 30 // 30 Day Expiration
	const expiresAt = Math.floor(Date.now() / 1000) + maxAge
	const payload = {
		sub: user.id,
		exp: expiresAt,
	}
	const token = await sign(payload, c.env.JWT_SECRET);
	setCookie(c, 'nvcal_session', token, {
		httpOnly: true,
		secure: true,
		sameSite: 'Strict',
		maxAge: maxAge,
		path: '/'
	})


	return c.json({ success: true, user_id: user.id }, 200);
});


export default authRouter;



