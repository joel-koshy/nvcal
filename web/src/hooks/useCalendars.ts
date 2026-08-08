import { useState, useEffect } from 'preact/hooks';
import { api } from '@/utils/api';
import type { Calendar } from "@nvcal/domain";
import type { ApiError } from '@/utils/api';

interface UseCalendarsReturn {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
}

export function useCalendars(): UseCalendarsReturn {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    api<{ calendars: Calendar[] }>('/api/calendars')
      .then((res) => {
        if (mounted) {
          setCalendars(res.calendars);
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