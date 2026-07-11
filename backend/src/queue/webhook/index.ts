import { ProcessWebhookPayload, Providers, SetupWebhookPayload } from "..";
import { Bindings } from "../../types";
import { processGoogleWebhook, setupGoogleWebhook } from "./google";

export async function setupWebhook(job: SetupWebhookPayload, env: Bindings): Promise<void> {

	switch (job.provider) {
		case Providers.GOOGLE:
			await setupGoogleWebhook(job, env)
			break;
	}

}

export async function processWebhook(job: ProcessWebhookPayload, env: Bindings): Promise<void> {
	switch (job.provider) {
		case Providers.GOOGLE:
			await processGoogleWebhook(job, env);
			break;
	}

}
