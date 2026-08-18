import { Hono } from 'hono'
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { PageStateSchema } from '@nvcal/domain';
import type { Bindings, Variables } from '../types';
import { JwtPayload } from '../types';
import { template } from "../generated/template"

const pageRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: Get current week bounds (Monday-Sunday) in UTC ISO format
function getCurrentWeekBounds() {
	const now = new Date();
	const day = now.getUTCDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;

	const monday = new Date(now);
	monday.setUTCDate(now.getUTCDate() + diffToMonday);
	monday.setUTCHours(0, 0, 0, 0);

	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);
	sunday.setUTCHours(23, 59, 59, 999);

	return {
		start: monday.toISOString(),
		end: sunday.toISOString()
	};
}

pageRouter.get('/', async (c) => {
	// Soft auth: try to get userId, but don't fail if not logged in
	let userId: string | null = null;
	try {
		const token = getCookie(c, 'nvcal_session');
		if (token) {
			const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as JwtPayload;
			userId = payload.sub;
		}
	} catch {
		// Not logged in or invalid token
	}

	// Get events for current week + the user's calendars, filtered by session
	let events: Record<string, unknown>[] = [];
	let calendars: Record<string, unknown>[] = [];
	if (userId) {
		const { start, end } = getCurrentWeekBounds();
		const result = await c.env.DB
			.prepare(`
				SELECT e.*
				FROM events e
				INNER JOIN calendars cal ON e.calendar_id = cal.id
				WHERE cal.user_id = ?
				AND e.start_time >= ?
				AND e.start_time <= ?
				ORDER BY e.start_time ASC
			`)
			.bind(userId, start, end)
			.all();
		events = result.results;

		const calResult = await c.env.DB
			.prepare(`
				SELECT * FROM calendars
				WHERE user_id = ?
				ORDER BY name ASC
			`)
			.bind(userId)
			.all();
		calendars = calResult.results;
	}

	// Validate the bootstrap against the unified page-state contract —
	// strips ownership columns (user_id), materializes entity defaults.
	const dbState = PageStateSchema.parse({
		events,
		calendars,
		authenticated: !!userId,
		user: userId ? { id: userId } : null,
	});
	const baseResponse = new Response(template, {
		headers: { 'content-type': 'text/html;charset=UTF-8' }
	})

	// Rewrite script/link src attributes to point to Vite dev server
	const rewritten = new HTMLRewriter()
		.on('head', {
			element(element) {
				const scriptTag = `<script id="initial-state" type="application/json">${JSON.stringify(dbState)}</script>`;
				element.append(scriptTag, { html: true });
			}
		})
		.transform(baseResponse);

	return rewritten;
})

export default pageRouter;
