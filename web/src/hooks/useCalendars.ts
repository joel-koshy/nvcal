import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '@/utils/api';
import type { Calendar, CalendarListResponse } from "@nvcal/domain";
import type { ApiError } from '@/utils/api';

interface UseCalendarsReturn {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCalendars(initialCalendars?: Calendar[]): UseCalendarsReturn {
  const [calendars, setCalendars] = useState<Calendar[]>(initialCalendars ?? []);
  const [loading, setLoading] = useState(initialCalendars == undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const res = await api<CalendarListResponse>('/api/calendars');
      setCalendars(res.calendars);
      setError(null);
    } catch (err) {
      const apiError = err as ApiError;
      console.error('[useCalendars] Error:', apiError);
      setError(apiError.message ?? 'Failed to fetch calendars');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialCalendars !== undefined) {
      return;
    }

    void refresh();
  }, [initialCalendars, refresh]);

  return { calendars, loading, error, refresh };
}
