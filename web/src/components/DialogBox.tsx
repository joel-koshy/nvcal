import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { VimContext } from '@/hooks/vim/VimProvider';
import { useNavigable } from '@/hooks/vim/useNavigable';

interface VimDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  anchorId?: string;
  id?: string;
  paneName?: string;
  children: ComponentChildren;
  onReposition?: (side: 'left' | 'right') => void;
  onSubmit?: (e: SubmitEvent) => void;
}

export function VimDialog({ isOpen, title, onClose, anchorId, id, paneName = 'dialog', onReposition, onSubmit, children }: VimDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ top: number, left: number, opacity: number, side: 'left' | 'right' }>({ top: 0, left: 0, opacity: 0, side: 'right' });
  const vimContext = useContext(VimContext);

  // Register/unregister pane only when dialog is open
  useEffect(() => {
    if (!isOpen || !vimContext) return;
    vimContext.registerPane(paneName, { cols: 1, flow: 'col', neighbors: {} });
    return () => {
      vimContext.unregisterPane(paneName);
    };
  }, [isOpen, paneName]);

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor) {
          const rect = anchor.getBoundingClientRect();
          const dialogRect = dialogRef.current.getBoundingClientRect();


          let left = rect.right + 10;
          let currentSide: 'left' | 'right' = 'right';

          // If the monitor runs out of space on the right, snap to the left side
          if (left + dialogRect.width > window.innerWidth) {
            left = rect.left - dialogRect.width - 10;
            currentSide = 'left';
          }

          let top = rect.top;
          const dialogHeight = dialogRef.current.offsetHeight || 250;
          if (top + dialogHeight > window.innerHeight) {
            top = window.innerHeight - dialogHeight - 10;
          }

          setPos({ top, left, opacity: 1, side: currentSide });
          if (onReposition) onReposition(currentSide);
        }
      }
    } else {
      setPos({ top: 0, left: 0, opacity: 0, side: 'right' });
      if (vimContext?.activePane == paneName) {
        vimContext.setActivePane('main')
      }
    }
  }, [isOpen, anchorId, title]);

  const handleDialogKey = (e: KeyboardEvent) => {
    const active = document.activeElement;
    const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (e.key === 'Escape') {
      e.stopPropagation(); // Don't let this bubble up to the global engine
      if (isTyping) {
        const parentRow = active.closest('.form-row') as HTMLElement;
        if (parentRow) {
          parentRow.focus();
        } else {
          active.blur();
        }
        return;
      }

      //If we have an anchor (Draft Block), hand focus back to it!
      if (anchorId) {
        const anchorNode = document.getElementById(anchorId);
        if (anchorNode) {
          anchorNode.focus();
          vimContext?.setActivePane('main');
        }
      } else {
        onClose();
      }
    }

    const directionKey = pos.side == 'left' ? 'L' : 'H'
    if (e.key === directionKey && !isTyping) {
      e.stopPropagation();
      e.preventDefault();

      if (anchorId) {
        document.getElementById(anchorId)?.focus();
        vimContext?.setActivePane('main');
      }
    }
  };
  return (
    <div
      class={anchorId ? "dialog-floating" : "dialog-overlay"}
      style={
        anchorId
          ? {
            top: pos.top,
            left: pos.left,
            opacity: pos.opacity,
            // Prevent transparent floating dialogs from eating mouse clicks
            pointerEvents: isOpen ? 'auto' : 'none'
          }
          : {
            // Standard overlays should fully disappear when closed
            display: isOpen ? 'flex' : 'none'
          }
      }
      onKeyDown={handleDialogKey}
    >
      {onSubmit ? (
        <form
          id={id}
          class="dialog-content"
          ref={dialogRef as any}
          onSubmit={onSubmit}
        >
          <h3>{title}</h3>
          {isOpen && children}
        </form>
      ) : (
        <div
          id={id}
          class="dialog-content"
          ref={dialogRef as any}
        >
          <h3>{title}</h3>
          {isOpen && children}
        </div>
      )}
    </div>
  );
}

interface VimFormRowProps {
  children: ComponentChildren;
  onClickAction?: () => void;
  paneName?: string;
}

export function VimFormRow({ children, onClickAction, paneName = 'dialog' }: VimFormRowProps) {
  const vimRef = useNavigable<HTMLDivElement>(paneName);
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (['i', 'a', 'Enter'].includes(e.key)) {
      e.preventDefault();
      const input = (e.currentTarget as HTMLElement).querySelector('input, textarea') as HTMLElement | null;
      if (input) input.focus();
      else if (onClickAction) onClickAction();
    }
  };

  return (
    <div class="form-row" tabIndex={0} onKeyDown={handleKeyDown} onClick={onClickAction} ref={vimRef}>
      {children}
    </div>
  );
}
