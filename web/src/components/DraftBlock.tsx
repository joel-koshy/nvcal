import type { DraftEvent } from "@/types/ui";

interface DraftBlockProps {
  draft: DraftEvent | null;
  dialogSide: 'left' | 'right';
  vimContext: any | null;
  setDraft: (updater: DraftEvent | null | ((prev: DraftEvent | null) => DraftEvent | null)) => void;
  weekDays: Date[];
  closeDialog: () => void;
}

export default function DraftBlock({ draft, dialogSide, vimContext, setDraft, weekDays, closeDialog }: DraftBlockProps) {
  if (!draft) return null;

  return (
    <div
      style={{
        gridColumn: draft.dayIndex + 2,
        gridRow: '2 / span 24',
        position: 'relative',
        pointerEvents: 'none', // Lets clicks pass through the full-column wrapper
        zIndex: 10 // Ensures draft floats above standard events
      }}
    >
      <div
        id="draft-event-block"
        class="draft-block"
        style={{
          position: 'absolute',
          top: `${(draft.hour / 24) * 100}%`,
          height: `${(draft.duration / 24) * 100}%`,
          width: '100%',
          left: 0,
          pointerEvents: 'auto', // Re-enables keyboard/click focus on the block itself
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.ctrlKey) return;
          const directionKey = dialogSide == 'left' ? 'H' : 'L'
          if (['i', 'a', 'Enter', directionKey].includes(e.key)) {
            e.stopPropagation();
            e.preventDefault();
            vimContext?.setActivePane('dialog');

            setTimeout(() => {
              if (e.key === directionKey) {
                const firstRow = document.querySelector('.dialog-content .form-row') as HTMLElement;
                if (firstRow) firstRow.focus();
              } else {
                const input = document.querySelector('.dialog-content input') as HTMLElement;
                if (input) input.focus();
              }
            }, 0);
            return;
          }

          if (['h', 'j', 'k', 'l'].includes(e.key)) {
            e.stopPropagation();
            e.preventDefault();
            setDraft(prev => {
              if (!prev) return null;

              let newDay = prev.dayIndex;
              let newHour = prev.hour;
              let newDur = prev.duration;

              // Rock-solid boundary math
              if (e.key === 'j' && newHour + newDur < 24) newDur++;
              if (e.key === 'k') {
                if (newDur > 1) newDur--;
                else if (newHour > 0) newHour--;
              }
              if (e.key === 'h' && newDay > 0) newDay--;
              if (e.key === 'l' && newDay < 6) newDay++;

              // FORCE a new Date object to trigger the React render cycle
              const newDate = new Date(weekDays[newDay]);
              newDate.setHours(newHour);

              return { ...prev,  dayIndex: newDay, hour: newHour, duration: newDur, date: newDate };
            });
          }
          // Prevent Macro Navigation while draft is open
          const trappedMacros = ['H', 'J', 'K', 'L'].filter(k => k !== directionKey);
          if (trappedMacros.includes(e.key)) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          if (e.key === 'Escape') {
            e.stopPropagation();
            closeDialog();
          }
        }}
      >

      </div>
    </div>

  )

}
