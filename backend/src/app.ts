import { Hono } from 'hono'
import authRouter from './routes/auth';
import { jwt } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from './types';
import { JwtPayload } from './types';
import pageRouter from './routes/page';
import apiRouter from './routes/api';
import webhookRouter from './routes/webhook';

const authMiddleware = createMiddleware(async (c, next) => {
	const jwtAuth = jwt({
		secret: c.env.JWT_SECRET,
		cookie: 'nvcal_session',
		alg: 'HS256'
	});

	return jwtAuth(c, next);
})
const loadToken = createMiddleware(async (c, next) => {
	const payload = c.get('jwtPayload') as JwtPayload | undefined;
	if (!payload?.sub) {
		return c.json({ error: "Invalid Token" }, 401);
	}
	c.set('userId', payload.sub);
	await next()
})

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', authMiddleware);
app.use('/api/*', loadToken);
app.route("/api/", apiRouter);

app.route("/auth", authRouter);
app.route("/webhooks", webhookRouter);
app.route("/", pageRouter);

export default app;
