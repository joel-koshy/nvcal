import { useState, useEffect, useContext, useMemo } from 'preact/hooks';
import { getWeekDays } from '@/utils/date.ts';
import { VimDialog, VimFormRow } from '@/components/DialogBox';
import { usePane } from '@/hooks/vim/usePane';
import { VimContext } from '@/hooks/vim/VimProvider';
import { Fragment } from 'preact/jsx-runtime';
import TimeSlot from '@/components/Timeslot';
import EventBlock from '@/components/EventBlock';
import DraftBlock from '@/components/DraftBlock';
import { DEFAULT_CALENDAR_ID } from '@/hooks/useEvents';

import type { Event } from "@nvcal/domain";
import type { DraftEvent } from "@/types/ui";
import type { EventMutations } from '@/hooks/useEvents';

interface MainWeekProps {
  date: Date;
  setDate: (d: Date) => void;
  events: Event[];
  loading: boolean;
  mutations: EventMutations;
}


export interface EventLayout {
  event: Event;
  top: number;    // Percentage (0-100)
  height: number; // Percentage (0-100)
  width: number;  // Percentage (0-100)
  left: number;   // Percentage (0-100)
}


export function processDayEvents(events: Event[], targetDay: Date): EventLayout[] {
  // 1. Filter for the target day and sort chronologically
  const dayEvents = events.filter(e => {
    const d = new Date(e.start_time);
    return d.getDate() === targetDay.getDate() && d.getMonth() === targetDay.getMonth();
  })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  // 2. Group overlapping events
  const layouts: EventLayout[] = [];
  const groups: Event[][] = [];
  let currentGroup: Event[] = [];
  let groupEnd = 0;

  dayEvents.forEach(ev => {
    const startMs = new Date(ev.start_time).getTime();
    const endMs = new Date(ev.end_time).getTime();

    if (currentGroup.length === 0 || startMs < groupEnd) {
      currentGroup.push(ev);
      groupEnd = Math.max(groupEnd, endMs);
    } else {
      groups.push([...currentGroup]);
      currentGroup = [ev];
      groupEnd = endMs;
    }
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  // 3. Assign spatial coordinates based on group size
  groups.forEach(group => {
    const columns: Event[][] = [];
    group.forEach(ev => {
      const startMs = new Date(ev.start_time).getTime();
      let placed = false;
      for (const col of columns) {
        const lastEvInCol = col[col.length - 1];
        if (startMs >= new Date(lastEvInCol.end_time).getTime()) {
          col.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([ev]);
    });
    const numCols = columns.length;
    columns.forEach((col, colIdx) => {
      col.forEach(ev => {
        const startDate = new Date(ev.start_time);
        const endDate = new Date(ev.end_time);

        const startFraction = startDate.getHours() + (startDate.getMinutes() / 60);
        const endFraction = endDate.getHours() + (endDate.getMinutes() / 60);

        layouts.push({
          event: ev,
          top: (startFraction / 24) * 100,
          height: ((endFraction - startFraction) / 24) * 100,
          width: 100 / numCols,
          left: (colIdx * 100) / numCols
        });
      });
    });
  });

  return layouts;
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MainWeek({ date, setDate, events, loading, mutations }: MainWeekProps) {
  const weekDays = getWeekDays(date);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [triggerNode, setTriggerNode] = useState<HTMLElement | null>(null);
  const vimContext = useContext(VimContext);
  const [dialogSide, setDialogSide] = useState<'left' | 'right'>('right');


  // kill draft upon leaving 
  useEffect(() => {
    if (draft && vimContext?.activePane !== 'main' && vimContext?.activePane !== 'dialog') {
      setDraft(null);
    }
  }, [vimContext?.activePane]);

  // update draft side and focus to draft
  useEffect(() => {
    if (draft) {
      setDialogSide(draft.dayIndex > 3 ? 'left' : 'right');
      setTimeout(() => {
        document.getElementById('draft-event-block')?.focus();
      }, 0);
    }
  }, [draft]);

  usePane('main', {
    cols: 7,
    flow: 'row',
    neighbors: { left: 'sidebar', up: 'topbar' }
  });

  const layoutsByDay = useMemo(() => {
    return weekDays.map(day => processDayEvents(events, day));
  }, [events, weekDays]);

  const eventsBySlot = useMemo(() => {
    const map = new Map<string, EventLayout[]>();

    layoutsByDay.forEach((dayLayouts, dayIndex) => {
      dayLayouts.forEach(layout => {
        const start = new Date(layout.event.start_time);
        const end = new Date(layout.event.end_time);
        const startHour = start.getHours();
        // Include the final hour only if event extends past the hour boundary
        const endHour = end.getMinutes() > 0 ? end.getHours() : end.getHours() - 1;

        for (let h = startHour; h <= endHour; h++) {
          const key = `${dayIndex},${h}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(layout);
        }
      });
    });

    return map;
  }, [layoutsByDay]);


  const closeDialog = () => {
    setDraft(null);
    triggerNode?.focus();
  };

  const handleSlotInteract = (trigger: HTMLElement, day: Date, hour: number, dayIndex: number) => {
    setTriggerNode(trigger);
    const newDate = new Date(day);
    newDate.setHours(hour);
    setDate(newDate);
    setDraft({ dayIndex, hour, duration: 1, date: newDate, calendarId: DEFAULT_CALENDAR_ID });
  };

  const handleEditEvent = (layout: EventLayout) => {
    setTriggerNode(document.activeElement as HTMLElement);
    const d = new Date(layout.event.start_time);
    const oldDuration = (new Date(layout.event.end_time).getTime() - new Date(layout.event.start_time).getTime()) / (1000 * 60 * 60);
    setDraft({
      eventId: layout.event.id,
      originalEvent: layout.event,
      calendarId: layout.event.calendar_id,
      dayIndex: weekDays.findIndex(day => day.toDateString() === d.toDateString()),
      hour: d.getHours() + d.getMinutes() / 60,
      duration: oldDuration,
      date: d,
    });
    vimContext?.setActivePane('dialog');
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!draft) return;

    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);

    const startTime = new Date(data.get('start_time') as string);
    const endTime = new Date(data.get('end_time') as string);

    const base = {
      calendar_id: draft.calendarId,
      title: data.get('title') as string,
      description: (data.get('description') as string) || null,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      is_all_day: data.get('is_all_day') === 'on' ? 1 : 0,
    };

    try {
      if (draft.eventId && draft.originalEvent) {
        await mutations.updateEvent(draft.eventId, {
          ...base,
          version: draft.originalEvent.version,
        });
      } else {
        await mutations.createEvent(base);
      }
      closeDialog();
    } catch {
      // 409 conflict — hook already merged currentState, close anyway
      closeDialog();
    }
  };

  const handleDelete = async () => {
    if (!draft?.eventId || !draft.originalEvent) return;
    try {
      await mutations.deleteEvent(draft.eventId, draft.originalEvent.version);
      closeDialog();
    } catch {
      closeDialog();
    }
  };

  const startDefault = draft?.date ?? new Date();
  const endDefault = new Date(startDefault.getTime() + (draft?.duration ?? 1) * 3600000);

  const formatHour = (h: number) => {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };

  return (
    <div class={`week-container${loading ? ' is-fetching' : ''}`}>

      <VimDialog
        isOpen={!!draft}
        anchorId="draft-event-block"
        title={draft?.eventId ? `Edit: ${draft.originalEvent?.title}` : `New: ${draft?.date.toLocaleString([], { weekday: 'short', hour: 'numeric' })}`}
        onClose={closeDialog}
        onSubmit={handleSubmit}
      >
        <VimFormRow>
          <label>Title</label>
          <input
            name="title"
            type="text"
            defaultValue={draft?.originalEvent?.title || ""}
          />
        </VimFormRow>

        <VimFormRow>
          <label>Description</label>
          <input
            name="description"
            type="text"
            defaultValue={draft?.originalEvent?.description || ""}
          />
        </VimFormRow>

        <VimFormRow>
          <label>Start</label>
          <input
            name="start_time"
            type="datetime-local"
            defaultValue={toDatetimeLocal(startDefault)}
          />
        </VimFormRow>

        <VimFormRow>
          <label>End</label>
          <input
            name="end_time"
            type="datetime-local"
            defaultValue={toDatetimeLocal(endDefault)}
          />
        </VimFormRow>

        <VimFormRow>
          <label>All Day</label>
          <input
            name="is_all_day"
            type="checkbox"
            defaultChecked={Boolean(draft?.originalEvent?.is_all_day)}
          />
        </VimFormRow>

        <VimFormRow>
          <button class="save-btn" type="submit">Save (Enter)</button>
        </VimFormRow>

        {draft?.eventId && (
          <VimFormRow onClickAction={handleDelete}>
            <button class="delete-btn" type="button">Delete</button>
          </VimFormRow>
        )}
      </VimDialog>

      <div class="grid-viewport">
        <div class="week-grid">
          <div class="time-gutter-header"></div>

          {weekDays.map((day, i) => {
            const isActive = day.toDateString() === date.toDateString() ? 'active-day' : '';
            return (
              <div key={`head-${i}`} class={`day-header ${isActive}`}>
                <div class="day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div class="day-num">{day.getDate()}</div>
              </div>
            );
          })}

          {/* --- The Visual Draft Block --- */}
          <DraftBlock
            draft={draft}
            dialogSide={dialogSide}
            vimContext={vimContext}
            setDraft={setDraft}
            weekDays={weekDays}
            closeDialog={closeDialog}
          />

          {/* --- The Background Grid --- */}
          {hours.map(hour => (
            <Fragment key={`hour-row-${hour}`}>
              <div key={`label-${hour}`} class="time-label"
                style={{
                  gridColumn: 1,
                  gridRow: hour + 2
                }}
              >
                <span>{formatHour(hour)}</span>
              </div>

              {weekDays.map((day, i) => (
                <div
                  key={`slot-wrap-${i}-${hour}`}
                  style={{ gridColumn: i + 2, gridRow: hour + 2 }}
                >

                  <TimeSlot
                    key={`slot-${i}-${hour}`}
                    day={day}
                    hour={hour}
                    dayIndex={i}
                    formatHour={formatHour}
                    onInteract={handleSlotInteract}
                    slotLayouts={eventsBySlot.get(`${i},${hour}`) ?? []}
                    onEditEvent={handleEditEvent}
                  />
                </div>
              ))}

            </Fragment>
          ))}

          {/* Events rendering */}
          {weekDays.map((_, i) => {
            const dayLayouts = layoutsByDay[i];
            return (
              <div key={`col-overlay-${i}`} class="day-events-column" style={{
                gridColumn: i + 2, gridRow: '2 / span 24', position: 'relative', pointerEvents: 'none'
              }}>
                {dayLayouts.map(layout => {
                  // Hide the original event if it's currently being moved in the draft
                  if (draft?.eventId === layout.event.id) return null;

                  return (
                    <EventBlock
                      key={layout.event.id}
                      layout={layout}
                      dayIndex={i}
                      onEdit={() => {
                        // Open directly to dialog
                        setTriggerNode(document.activeElement as HTMLElement);
                        const d = new Date(layout.event.start_time);
                        setDraft({
                          eventId: layout.event.id,
                          originalEvent: layout.event,
                          calendarId: layout.event.calendar_id,
                          dayIndex: i,
                          hour: d.getHours(),
                          duration: 1,
                          date: d,
                        });
                        vimContext?.setActivePane('dialog');
                      }}
                      onMove={() => {
                        // Enter Visual/Move mode
                        setTriggerNode(document.activeElement as HTMLElement);
                        const d = new Date(layout.event.start_time);
                        setDraft({
                          eventId: layout.event.id,
                          originalEvent: layout.event,
                          calendarId: layout.event.calendar_id,
                          dayIndex: i, hour: d.getHours(), duration: layout.height / (100 / 24), date: d
                        });
                      }}
                    />
                  )
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
