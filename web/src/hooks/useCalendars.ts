import { useState, useEffect } from 'preact/hooks';
import { api } from '@/utils/api';
import type { Calendar } from "@nvcal/domain";
import type { ApiError } from '@/utils/api';

interface UseCalendarsReturn {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
  authenticated: boolean;
}

export function useCalendars(): UseCalendarsReturn {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    api<{ calendars: Calendar[] }>('/api/calendars')
      .then((res) => {
        if (mounted) {
          setCalendars(res.calendars);
          setAuthenticated(true);
          setLoading(false);
        }
      })
      .catch((err: ApiError) => {
        if (mounted) {
          console.error('[useCalendars] Error:', err);
          if (err.status === 401) {
            setError('Please log in to view calendars');
            setAuthenticated(false);
          } else {
            setError(err.message ?? 'Failed to fetch calendars');
          }
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { calendars, loading, error, authenticated };
}