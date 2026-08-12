import { useContext, useEffect, useState } from 'preact/hooks';
import { useNavigable } from '@/hooks/vim/useNavigable';
import { usePane } from '@/hooks/vim/usePane';
import { VimContext } from '@/hooks/vim/VimProvider';
import { VimDialog, VimFormRow } from '@/components/DialogBox';
import { api } from '@/utils/api';
import { MOCK_GOOGLE_CALENDARS } from '@/mock/events';
import type { Calendar, CreateCalendarInput, GoogleCalendarItem } from "@nvcal/domain";
import type { ApiResponse } from '@/types/api';

// Presets mirror the mock calendars' palette (Rose/Sky/Pink) plus two matching
// Catppuccin tones to round it out to five.
const CALENDAR_PRESET_COLORS: readonly string[] = [
  '#dc8a78', // Rose
  '#04a5e5', // Sky
  '#ea76cb', // Pink
  '#a6e3a1', // Green
  '#f9e2af', // Yellow
];

interface CalendarItemProps {
  calendar: Calendar;
  isActive: boolean;
  onClick: () => void;
  onCreate: () => void;
}

function CalendarItem({ calendar, isActive, onClick, onCreate }: CalendarItemProps) {
  const vimRef = useNavigable<HTMLButtonElement>('sidebar-calendars');

  return (
    <button
      ref={vimRef}
      class={`calendar-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        // Normal-mode "i" opens the create-calendar dialog (mirrors LoginButton)
        if (e.key === 'i') {
          e.preventDefault();
          e.stopPropagation();
          onCreate();
        }
      }}
      style={{ '--calendar-color': calendar.color_hex }}
    >
      <span class="calendar-color-indicator"></span>
      <span class="calendar-name">{calendar.name}</span>
      {calendar.is_external && <span class="calendar-external-badge">⟳</span>}
    </button>
  );
}

interface ColorSelectorProps {
  colors: readonly string[];
  selected: string;
  onSelect: (color: string) => void;
}

function ColorSelector({ colors, selected, onSelect }: ColorSelectorProps) {
  const vimRef = useNavigable<HTMLDivElement>('create-calendar');

  const cycle = (dir: 1 | -1) => {
    const idx = colors.indexOf(selected);
    const next = (idx + dir + colors.length) % colors.length;
    onSelect(colors[next]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Consume h/l here so the global engine never treats them: grabbing a single
    // row they cycle the palette instead of moving the vim cursor.
    if (e.key === 'h' || e.key === 'l') {
      e.preventDefault();
      e.stopPropagation();
      cycle(e.key === 'h' ? -1 : 1);
    }
  };

  return (
    <div class="form-row" tabIndex={0} onKeyDown={handleKeyDown} ref={vimRef}>
      <label>Color</label>
      <div class="color-picker">
        <div class="color-swatches">
          {colors.map((color) => (
            <button
              type="button"
              key={color}
              tabIndex={-1}
              class={`color-swatch ${color === selected ? 'selected' : ''}`}
              style={{ background: color }}
              onClick={() => {
                onSelect(color);
                // keep the vim cursor on the row after a mouse pick
                vimRef.current?.focus();
              }}
              aria-label={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ImportItemProps {
  item: GoogleCalendarItem;
  checked: boolean;
  onToggle: () => void;
}

function ImportItem({ item, checked, onToggle }: ImportItemProps) {
  const vimRef = useNavigable<HTMLButtonElement>('create-calendar');

  return (
    <button
      type="button"
      ref={vimRef}
      class={`import-item ${checked ? 'checked' : ''}`}
      onClick={onToggle}
      style={{ '--calendar-color': item.color ?? '#6c7086' }}
    >
      <span class="import-check">{checked ? '✓' : ''}</span>
      <span class="calendar-color-indicator"></span>
      <span class="calendar-name">{item.name}</span>
    </button>
  );
}

interface SidebarCalendarsProps {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
}

type CreateTab = 'create' | 'import';

export function SidebarCalendars({ calendars, loading, error }: SidebarCalendarsProps) {
  const vimContext = useContext(VimContext);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selectedColor, setSelectedColor] = useState(CALENDAR_PRESET_COLORS[0]);
  const [tab, setTab] = useState<CreateTab>('create');
  const [discoverable, setDiscoverable] = useState<GoogleCalendarItem[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importFetched, setImportFetched] = useState(false);
  const [selectedImportIds, setSelectedImportIds] = useState<ReadonlySet<string>>(new Set());

  // Auto-detect the user's own timezone for the selector's default value.
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  usePane('sidebar-calendars', {
    cols: 1,
    flow: 'col',
    neighbors: { up: 'sidebar', right: 'main' },
  });

  // Discover importable calendars the first time the Import tab is opened.
  // Falls back to mock data when the sync route is unreachable.
  useEffect(() => {
    if (tab !== 'import' || importFetched) return;
    setImportFetched(true);
    setImportLoading(true);
    api<ApiResponse<'/api/sync/google/calendars GET'>>('/api/sync/google/calendars', 'GET')
      .then((res) => {
        setDiscoverable(res.calendars);
        setImportLoading(false);
      })
      .catch(() => {
        setDiscoverable(MOCK_GOOGLE_CALENDARS);
        setImportLoading(false);
        setCreateError('Sync offline - sample data');
      });
  }, [tab, importFetched]);

  const openCreate = () => {
    if (showCreate) return;
    setShowCreate(true);
    setCreateError('');
    setSelectedColor(CALENDAR_PRESET_COLORS[0]);
    setTab('create');
    setSelectedImportIds(new Set());
    vimContext?.setActivePane('create-calendar');
    setTimeout(() => {
      (document.querySelector('#create-calendar-dialog input') as HTMLElement | null)?.focus();
    }, 0);
  };

  const switchTab = (next: CreateTab) => {
    setTab(next);
    setCreateError('');
  };

  const closeCreate = () => {
    setShowCreate(false);
    vimContext?.setActivePane('sidebar-calendars');
    setTimeout(() => {
      const target = (document.querySelector('.calendar-item') ?? document.querySelector('.add-calendar-btn')) as HTMLElement | null;
      target?.focus();
    }, 0);
  };

  const handleCreate = async (e: SubmitEvent) => {
    e.preventDefault();
    setCreateError('');
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);

    const body: CreateCalendarInput = {
      name: String(data.get('name') ?? '').trim(),
      timezone: String(data.get('timezone') ?? 'UTC').trim() || 'UTC',
      color_hex: selectedColor,
    };

    try {
      await api<ApiResponse<'/api/calendars POST'>>('/api/calendars', 'POST', body);
      closeCreate();
    } catch (err: any) {
      setCreateError(err.message ?? 'Failed to create calendar');
    }
  };

  const toggleImport = (id: string) => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedImportIds.size === 0) return;
    try {
      await api<ApiResponse<'/api/sync/google/import POST'>>('/api/sync/google/import', 'POST', {
        googleCalendarIds: [...selectedImportIds],
      });
      closeCreate();
    } catch (err: any) {
      setCreateError(err.message ?? 'Import failed');
    }
  };

  // Clamp active index to valid range
  const clampedIndex = Math.min(activeIndex, calendars.length - 1);

  return (
    <div class="sidebar-calendars">
      <div class="calendars-header-row">
        <div class="header">Calendars</div>
        <button class="add-calendar-btn" onClick={openCreate} aria-label="Create calendar">+</button>
      </div>

      {loading ? (
        <div class="calendars-loading">Loading calendars...</div>
      ) : error ? (
        <div class="calendars-error">Error: {error}</div>
      ) : calendars.length === 0 ? (
        <div class="calendars-empty">No calendars found</div>
      ) : (
        <div class="calendars-list">
          {calendars.map((calendar, index) => (
            <CalendarItem
              key={calendar.id}
              calendar={calendar}
              isActive={index === clampedIndex}
              onClick={() => setActiveIndex(index)}
              onCreate={openCreate}
            />
          ))}
        </div>
      )}

      <VimDialog
        isOpen={showCreate}
        title={tab === 'create' ? 'New Calendar' : 'Import Calendar'}
        id="create-calendar-dialog"
        paneName="create-calendar"
        onClose={closeCreate}
        onSubmit={handleCreate}
      >
        <VimFormRow
          paneName="create-calendar"
          onClickAction={() => switchTab(tab === 'create' ? 'import' : 'create')}
        >
          <div class="auth-tabs">
            <button
              type="button"
              class={`auth-tab ${tab === 'create' ? 'active' : ''}`}
              onClick={() => switchTab('create')}
            >
              Create
            </button>
            <button
              type="button"
              class={`auth-tab ${tab === 'import' ? 'active' : ''}`}
              onClick={() => switchTab('import')}
            >
              Import
            </button>
          </div>
        </VimFormRow>

        {tab === 'create' ? (
          <>
            <VimFormRow paneName="create-calendar">
              <label>Name</label>
              <input name="name" type="text" placeholder="Work" />
            </VimFormRow>

            <VimFormRow paneName="create-calendar">
              <label>Timezone</label>
              <input name="timezone" type="text" defaultValue={detectedTimezone} />
            </VimFormRow>

            <ColorSelector
              colors={CALENDAR_PRESET_COLORS}
              selected={selectedColor}
              onSelect={setSelectedColor}
            />

            {createError && <div class="auth-error">{createError}</div>}

            <VimFormRow paneName="create-calendar">
              <button class="save-btn" type="submit">Create</button>
            </VimFormRow>
          </>
        ) : (
          <>
            {importLoading ? (
              <div class="calendars-loading">Loading...</div>
            ) : (
              <div class="import-list">
                {discoverable.map((item) => (
                  <ImportItem
                    key={item.id}
                    item={item}
                    checked={selectedImportIds.has(item.id)}
                    onToggle={() => toggleImport(item.id)}
                  />
                ))}
                {discoverable.length === 0 && (
                  <div class="calendars-empty">No calendars to import</div>
                )}
              </div>
            )}

            {createError && <div class="auth-error">{createError}</div>}

            <VimFormRow paneName="create-calendar">
              <button
                class="save-btn"
                type="button"
                onClick={handleImport}
                disabled={selectedImportIds.size === 0}
              >
                Import
              </button>
            </VimFormRow>
          </>
        )}
      </VimDialog>
    </div>
  );
}