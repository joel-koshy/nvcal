import { useNavigable } from "@/hooks/vim/useNavigable";
import type { EventLayout } from "@/panes/MainWeek";
import { useState } from "preact/hooks";

interface TimeSlotProps {
  day: Date;
  hour: number;
  dayIndex: number;
  formatHour: (h: number) => string;
  onInteract: (trigger: HTMLElement, day: Date, hour: number, dayIndex: number) => void;

  slotLayouts: EventLayout[];
  onEditEvent: (layout: EventLayout) => void;
}

export default function TimeSlot({ day, hour, dayIndex, formatHour, onInteract, slotLayouts, onEditEvent }: TimeSlotProps) {
  const vimRef = useNavigable<HTMLButtonElement>('main');
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const isPicking = pickerIndex !== null;
  const openPicker = () => {
    if (slotLayouts.length == 1) {
      onEditEvent(slotLayouts[0]);
    } else if (slotLayouts.length > 1) {
      setPickerIndex(0);
    }
  };
  const confirmPick = () => {
    if (pickerIndex != null) {
      onEditEvent(slotLayouts[pickerIndex]);
      setPickerIndex(null);
    }
  };
  const closePicker = () => setPickerIndex(null);


  return (
    <div className='time-slot-wrapper'>
      <button
        ref={vimRef}
        class="time-slot"
        aria-label={`Time slot for ${formatHour(hour)} on ${day.toDateString()}`}
        onKeyDown={(e) => {
          if (isPicking) {
            e.stopPropagation();
            e.preventDefault();
            if (e.key === 'j') {
              setPickerIndex(i => Math.min((i ?? 0) + 1, slotLayouts.length - 1));
            } else if (e.key === 'k') {
              setPickerIndex(i => Math.max((i ?? 0) - 1, 0));
            } else if (e.key === 'Enter') {
              confirmPick();
            } else if (e.key === 'Escape') {
              closePicker();
            }
            return;
          }


          if (['i', 'a', 'Enter'].includes(e.key)) {
            e.preventDefault();
            onInteract(e.currentTarget as HTMLElement, day, hour, dayIndex);
          }

          // c: edit directly (single event) or open picker (multiple)
          if (e.key === 'c') {
            e.preventDefault();
            e.stopPropagation();
            openPicker();
            return;
          }

          // v: always open picker regardless of event count (explicit selection intent)
          if (e.key === 'v') {
            e.preventDefault();
            e.stopPropagation();
            if (slotLayouts.length > 0) setPickerIndex(0);
            return;
          }
        }}
        onClick={(e) => onInteract(e.currentTarget as HTMLElement, day, hour, dayIndex)}
      />
      {isPicking && (
        <div class="slot-picker" role="listbox" aria-label="Select event">
          {slotLayouts.map((layout, idx) => (
            <div
              key={layout.event.id}
              class={`slot-picker-item ${idx === pickerIndex ? 'highlighted' : ''}`}
              role="option"
              aria-selected={idx === pickerIndex}
              onClick={() => { setPickerIndex(idx); confirmPick(); }}
            >
              <span class="picker-dot" style={{ background: layout.event.calendar_id }} />
              {layout.event.title}
            </div>
          ))}
        </div>
      )}


    </div>
  );
}


