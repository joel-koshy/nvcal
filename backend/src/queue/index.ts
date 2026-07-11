import { importExternalCalendars } from "./importCalendars"
import type { Bindings } from "../types"
import { processWebhook, setupWebhook } from "./webhook"
import { exportUpdates } from "./export"

export enum JobAction {
	IMPORT_CAL,
	SETUP_WEBHOOK_WATCH,
	PROCESS_WEBHOOK,
	EXPORT_EVENT,
	UPDATE_EVENT,
};
export enum Providers {
	GOOGLE,
}

export interface ImportJobPayload {
	userId: string,
	localCalendarId: string,
	externalCalendarId: string
	provider: Providers,
	pageToken?: string
}

export interface SetupWebhookPayload {
	userId: string,
	provider: Providers,
	calendarId: string
}
export interface ProcessWebhookPayload {
	provider: Providers,
	channelId: string,
}
export interface ExportEventPayload {
	userId: string,
	externalCalendarId: string,
	provider: Providers,
	action: 'PUT' | 'POST' | 'DELETE',
	eventId?: string, // POST, PATCH/PUT
	externalEventId?: string; // DELETE
}

export interface OtherJobPayload {
	val: string
};
// Each job variant pairs an action with its specific payload
type ImportCalJob = {
	action: JobAction.IMPORT_CAL,
	payload: ImportJobPayload
}
type SetupWebhookJob = {
	action: JobAction.SETUP_WEBHOOK_WATCH,
	payload: SetupWebhookPayload,
}
type UpdateEventJob = {
	action: JobAction.UPDATE_EVENT,
	payload: OtherJobPayload
}
type ExportEventJob = {
	action: JobAction.EXPORT_EVENT,
	payload: ExportEventPayload
}
type ProcessWebhookJob = {
	action: JobAction.PROCESS_WEBHOOK,
	payload: ProcessWebhookPayload
}

// Discriminated union — TypeScript narrows payload when you switch on action
export type Job = ImportCalJob | UpdateEventJob | SetupWebhookJob | ProcessWebhookJob | ExportEventJob

export async function queueHandler(job: Job, env: Bindings): Promise<void> {

	switch (job.action) {
		case JobAction.IMPORT_CAL:
			await importExternalCalendars(job.payload, env);
			break;
		case JobAction.SETUP_WEBHOOK_WATCH:
			await setupWebhook(job.payload, env)
			break;
		case JobAction.PROCESS_WEBHOOK:
			await processWebhook(job.payload, env)
			break;
		case JobAction.EXPORT_EVENT:
			await exportUpdates(job.payload, env)
			break;
	}
}
