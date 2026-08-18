import { useState } from 'preact/hooks';
import { useNavigable } from '@/hooks/vim/useNavigable';
import { usePane } from '@/hooks/vim/usePane';
import type { Calendar } from "@nvcal/domain";

interface CalendarItemProps {
  calendar: Calendar;
  isActive: boolean;
  onClick: () => void;
}

function CalendarItem({ calendar, isActive, onClick }: CalendarItemProps) {
  const vimRef = useNavigable<HTMLButtonElement>('sidebar-calendars');

  return (
    <button
      ref={vimRef}
      class={`calendar-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{ '--calendar-color': calendar.color_hex }}
    >
      <span class="calendar-color-indicator"></span>
      <span class="calendar-name">{calendar.name}</span>
      {calendar.is_external && <span class="calendar-external-badge">⟳</span>}
    </button>
  );
}

interface SidebarCalendarsProps {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
}

export function SidebarCalendars({ calendars, loading, error }: SidebarCalendarsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  usePane('sidebar-calendars', {
    cols: 1,
    flow: 'col',
    neighbors: { up: 'sidebar', right: 'main' },
  });

  if (loading) {
    return <div class="calendars-loading">Loading calendars...</div>;
  }

  if (error) {
    return <div class="calendars-error">Error: {error}</div>;
  }

  if (calendars.length === 0) {
    return <div class="calendars-empty">No calendars found</div>;
  }

  // Clamp active index to valid range
  const clampedIndex = Math.min(activeIndex, calendars.length - 1);

  return (
    <div class="sidebar-calendars">
      <div class="header">Calendars</div>
      <div class="calendars-list">
        {calendars.map((calendar, index) => (
          <CalendarItem
            key={calendar.id}
            calendar={calendar}
            isActive={index === clampedIndex}
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </div>
    </div>
  );
}
