import { useState } from 'preact/hooks';
import { useNavigable } from '@/hooks/vim/useNavigable';
import { usePane } from '@/hooks/vim/usePane';
import { useCalendars } from '@/hooks/useCalendars';
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

export function SidebarCalendars() {
  const { calendars, loading, error } = useCalendars();
  const [activeIndex, setActiveIndex] = useState(0);

  usePane('sidebar-calendars', {
    cols: 1,
    flow: 'col',
    neighbors: { up: 'sidebar' },
  });

  if (loading) {
    return <div class="calendars-loading">Loading calendars...</div>;
  }

  // if (!authenticated) {
  //   return (
  //     <div class="calendars-auth-required">
  //       <span>🔒</span>
  //       <div>Please log in to view calendars</div>
  //     </div>
  //   );
  // }
  //
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
      <div class="calendars-header">Calendars</div>
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
