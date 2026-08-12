import { useState, useEffect } from 'preact/hooks';
import { api } from '@/utils/api';
import type { Calendar, CalendarListResponse } from "@nvcal/domain";
import type { ApiError } from '@/utils/api';

interface UseCalendarsReturn {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
}

/**
 * Calendar fetcher. Seeds from the server's embedded initial state (no
 * round-trip on first paint), then re-fetches on mount to reconcile with
 * anything that changed server-side since render.
 *
 * Purely data lifecycle — auth failures are surfaced by the api layer
 * (login modal) and arrive here as a plain error.
 */
export function useCalendars(initial: Calendar[]): UseCalendarsReturn {
  const [calendars, setCalendars] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
          console.error('[useCalendars] Error:', err);
          setError(err.message ?? 'Failed to fetch calendars');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { calendars, loading, error };
}
