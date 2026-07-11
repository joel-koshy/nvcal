import { useNavigable } from "@/hooks/vim/useNavigable";
import { MOCK_CALENDAR_COLORS } from "@/mock/events";

import type { EventLayout } from "@/panes/MainWeek";


export default function EventBlock({ layout, onEdit, onMove }: { layout: EventLayout, dayIndex: number, onEdit: () => void, onMove: () => void }) {
  const vimRef = useNavigable<HTMLDivElement>('main');
  const color = MOCK_CALENDAR_COLORS[layout.event.calendar_id] || '#ffffff';

  return (
    <div
      ref={vimRef}
      class="event-block"
      tabIndex={0}
      style={{
        position: 'absolute',
        top: `${layout.top}%`,
        height: `${layout.height}%`,
        left: `${layout.left}%`,
        width: `${layout.width}%`,
        backgroundColor: color,
        border: '1px solid #1e1e2e',
        borderRadius: '4px',
        padding: '2px 4px',
        fontSize: '0.75rem',
        overflow: 'hidden',
        pointerEvents: 'auto'
      }}

      onKeyDown={(e) => {
        if (e.key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          onEdit();
        }
        if (e.key === 'm' || e.key === 'v') {
          e.preventDefault();
          e.stopPropagation();
          onMove();
        }
      }}
    >
      <strong>{layout.event.title}</strong>
    </div>
  );
}
