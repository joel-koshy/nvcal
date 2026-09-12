import { useState, useEffect } from 'preact/hooks';
import { api } from '@/utils/api';
import type { Calendar, CalendarListResponse } from "@nvcal/domain";
import type { ApiError } from '@/utils/api';

interface UseCalendarsReturn {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
}

export function useCalendars(initialCalendars?: Calendar[]): UseCalendarsReturn {
  const [calendars, setCalendars] = useState<Calendar[]>(initialCalendars ?? []);
  const [loading, setLoading] = useState(initialCalendars == undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCalendars !== undefined) {
      return;
    }

    let mounted = true;
    setLoading(true);

    api<CalendarListResponse>('/api/calendars')
      .then((res) => {
        if (mounted) {
          setCalendars(res.calendars);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: ApiError) => {
        if (mounted) {
          console.error('[useCalendars] Error:', err)
          setError(err.message ?? 'Failed to fetch calendars');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [initialCalendars]);

  return { calendars, loading, error };
}
