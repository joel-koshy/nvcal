export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;

  // Progress Tracking
  status: TaskStatus;
  target_steps: number; // Defaults to 1 in DB
  completed_steps: number; // Defaults to 0 in DB

  due_date: string | null; // ISO-8601 string or null

  version: number; // OCC Versioning
}

