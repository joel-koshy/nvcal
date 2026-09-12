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
        backgroundColor: color,
        top: `${layout.top}%`,
        height: `${layout.height}%`,
        left: `${layout.left}%`,
        width: `${layout.width}%`,

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
      <div>{layout.event.title}</div>
    </div>
  );
}
