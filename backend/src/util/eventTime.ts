/**
 * Convert a provider or legacy database timestamp to the UTC ISO format used
 * by the shared EventSchema. Google all-day events are date-only, which is
 * represented locally as midnight UTC and identified by `is_all_day`.
 */
export function toUtcIsoDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid event timestamp: ${value}`);
	}
	return date.toISOString();
}

export interface GoogleEventTime {
	dateTime?: string;
	date?: string;
}

export function normalizeGoogleEventTimes(start: GoogleEventTime, end: GoogleEventTime) {
	const isAllDay = start.date ? 1 : 0;
	const startValue = start.dateTime ?? start.date;
	const endValue = end.dateTime ?? end.date;
	if (!startValue || !endValue) {
		throw new Error("Google event is missing a start or end time");
	}

	return {
		start_time: toUtcIsoDateTime(startValue),
		end_time: toUtcIsoDateTime(endValue),
		is_all_day: isAllDay,
	};
}

/** Normalize legacy event rows as they cross a response boundary. */
export function normalizeStoredEventTimes(event: Record<string, unknown>): Record<string, unknown> {
	const { start_time, end_time } = event;
	if (typeof start_time !== "string" || typeof end_time !== "string") {
		return event;
	}

	return {
		...event,
		start_time: toUtcIsoDateTime(start_time),
		end_time: toUtcIsoDateTime(end_time),
	};
}
