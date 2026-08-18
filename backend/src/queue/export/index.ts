import { Providers, type ExportEventPayload } from ".."
import { Bindings } from "../../types";
import { exportGoogleEvents } from "./google";

export async function exportUpdates(job: ExportEventPayload, env: Bindings) {

	switch (job.provider) {
		case Providers.GOOGLE:
			await exportGoogleEvents(job, env)
			break;
	}
}
