import type { Calendar, Event } from "@nvcal/domain";

// --- Mock Data ---
export const MOCK_CALENDAR_COLORS: Record<string, string> = {
  'cal_1': '#dc8a78', // Rose
  'cal_2': '#04a5e5', // Sky
  'cal_3': '#ea76cb', // Pink
  'cal_4': '#ea76cb'  // Pink
};

const baseCalendar = (id: string, name: string, color_hex: string, is_external: number): Calendar => ({
  id, name, color_hex, timezone: 'UTC', is_external,
  external_provider: null, external_calendar_id: null,
  sync_token: null, sync_channel_id: null, sync_resource_id: null,
  version: 1,
});

export const MOCK_CALENDARS: Calendar[] = [
  baseCalendar('cal_1', 'Work', '#dc8a78', 0),
  baseCalendar('cal_2', 'Standups', '#04a5e5', 0),
  baseCalendar('cal_3', 'Deep Work', '#ea76cb', 0),
];

export const MOCK_EVENTS: Event[] = [
  {
    // event is at 9 am
    id: 'evt_1', calendar_id: 'cal_1', task_id: null,
    title: 'Architecture Review', description: 'Single-file constraint discussion',
    start_time: '2026-05-21T13:00:00Z', end_time: '2026-05-21T14:00:00Z', // 1 hour
    is_all_day: 0, rrule: null, external_event_id: null, version: 1
  },
  {
    // event is at 9: 30 am
    id: 'evt_2', calendar_id: 'cal_2', task_id: null,
    title: 'Standup', description: null,
    start_time: '2026-05-21T13:30:00Z', end_time: '2026-05-21T17:00:00Z', // 0.5 hour (overlaps evt_1)
    is_all_day: 0, rrule: null, external_event_id: null, version: 1
  },
  {
    //event is at 5 AM 
    id: 'evt_3', calendar_id: 'cal_3', task_id: null,
    title: 'Deep Work: Vim Engine', description: null,
    start_time: '2026-05-22T09:00:00Z', end_time: '2026-05-22T12:00:00Z', // 3 hours
    is_all_day: 0, rrule: null, external_event_id: null, version: 1
  }
];
