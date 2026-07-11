import { useState, useEffect, useRef } from 'preact/hooks';
import { api } from '@/utils/api';
import { getWeekDays } from '@/utils/date';

import type { Event } from '@/types/events';
import type { ApiResponse } from '@/types/api';
import type { CreateEventRequest, UpdateEventRequest } from '@/types/api/events';

// TODO: Replace with real calendar ID from user's calendars
export const DEFAULT_CALENDAR_ID = 'cal_001';

export interface EventMutations {
  createEvent(req: CreateEventRequest): Promise<Event>;
  updateEvent(id: string, req: UpdateEventRequest): Promise<Event>;
  deleteEvent(id: string, version: number): Promise<void>;
}

/**
 * Time-window-aware event fetcher. Seeds from the Cloudflare Worker's
 * embedded initial data, then re-fetches as the visible week changes.
 *
 * Keeps stale data visible during fetch to prevent layout thrash.
 */
export function useEvents(date: Date, initial: Event[]) {
  const [events, setEvents] = useState(initial);
  const [loading, setLoading] = useState(false);
  const prevWindow = useRef('');
  const reqId = useRef(0);

  useEffect(() => {
    const week = getWeekDays(date);
    const start = week[0].toISOString();
    const end = week[6].toISOString();
    const key = start + '|' + end;

    // Same window as last fetch — nothing to do
    if (key === prevWindow.current) return;
    prevWindow.current = key;

    const id = ++reqId.current;
    setLoading(true);

    api<ApiResponse<'/api/events GET'>>(
      `/api/events?start=${start}&end=${end}`
    )
      .then((res) => {
        // Discard if a newer request fired while we were in-flight
        if (id !== reqId.current) return;
        setEvents(res.events);
        setLoading(false);
      })
      .catch(() => {
        if (id !== reqId.current) return;
        // Keep stale data visible — just stop the loading indicator
        setLoading(false);
      });
  }, [date]);

  const mutations: EventMutations = {
    async createEvent(req) {
      const res = await api<ApiResponse<'/api/events POST'>>(
        '/api/events', 'POST', req
      );
      setEvents(prev => [...prev, res.event]);
      return res.event;
    },

    async updateEvent(id, req) {
      const res = await api<ApiResponse<'/api/events PUT'>>(
        `/api/events/${id}`, 'PUT', req
      );
      setEvents(prev => prev.map(e => e.id === id ? res.event : e));
      return res.event;
    },

    async deleteEvent(id, version) {
      await api<ApiResponse<'/api/events DELETE'>>(
        `/api/events/${id}?version=${version}`, 'DELETE'
      );
      setEvents(prev => prev.filter(e => e.id !== id));
    },
  };

  return { events, loading, mutations };
}
