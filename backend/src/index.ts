import app from "./app";
import { queueHandler } from "./queue";
import type { Bindings } from "./types";

export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
		for (const message of batch.messages) {
			await queueHandler(message.body, env);
		}
	}
}
