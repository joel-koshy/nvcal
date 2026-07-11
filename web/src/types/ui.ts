import type { Event } from "./events";

export interface DraftEvent {
  eventId?: string;
  originalEvent?: Event;
  calendarId: string;
  dayIndex: number;
  hour: number;
  duration: number;
  date: Date;
}

export interface NvCalState{
  events: Event[]; 
}
