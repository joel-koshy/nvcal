import { Hono } from "hono";
import type { Bindings } from "../../types"
import { JobAction, Providers } from "../../queue";

const googleWebHookRouter = new Hono<{ Bindings: Bindings }>();

googleWebHookRouter.post('/', async (c) => {
	const channelId = c.req.header('x-goog-channel-id');
	const resourceState = c.req.header('x-goog-resource-state');

	if (resourceState === 'sync') return new Response('OK', { status: 200 });

	if (channelId) {
		await c.env.SYNC_QUEUE.send({
			action: JobAction.PROCESS_WEBHOOK,
			payload: {
				provider: Providers.GOOGLE,
				channelId: channelId
			}
		});
	}

	return new Response('OK', { status: 200 });
});

export default googleWebHookRouter;
