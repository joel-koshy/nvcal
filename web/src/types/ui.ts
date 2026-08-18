import type { Event } from "@nvcal/domain";

export interface DraftEvent {
  eventId?: string;
  originalEvent?: Event;
  calendarId: string;
  dayIndex: number;
  hour: number;
  duration: number;
  date: Date;
}

export interface UserInfo {
  id: string;
}

export interface NvCalState {
  events: Event[];
  authenticated: boolean;
  user: UserInfo | null;
}
