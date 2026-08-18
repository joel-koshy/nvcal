export interface Event {
  id: string;
  calendar_id: string;
  task_id: string | null;

  title: string;
  description: string | null;

  // Time bounds
  start_time: string; // ISO-8601 UTC string
  end_time: string; // ISO-8601 UTC string
  is_all_day: boolean; // Mapped from DB INTEGER 0/1

  // Recurrence Standard
  rrule: string | null; // e.g., 'FREQ=WEEKLY;BYDAY=MO,WE,FR'

  // External Integration Link
  external_event_id: string | null;

  version: number; // OCC Versioning
}
