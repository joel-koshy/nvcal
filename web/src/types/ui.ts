import type { Event, PageState } from "@nvcal/domain";

export interface DraftEvent {
  eventId?: string;
  originalEvent?: Event;
  calendarId: string;
  dayIndex: number;
  hour: number;
  duration: number;
  date: Date;
}

/**
 * The server-embedded bootstrap state. Shape owned by @nvcal/domain
 * (PageStateSchema) — this alias exists only so the SPA has one name for it.
 */
export type NvCalState = PageState;
