import { useContext, useEffect, useState } from 'preact/hooks';
import { useNavigable } from '@/hooks/vim/useNavigable';
import { usePane } from '@/hooks/vim/usePane';
import { VimContext } from '@/hooks/vim/VimProvider';
import { VimDialog, VimFormRow } from '@/components/DialogBox';
import { api } from '@/utils/api';
import { MOCK_GOOGLE_CALENDARS } from '@/mock/events';
import type { Calendar, CreateCalendarInput, GoogleCalendarItem, ImportGoogleCalendarInput } from "@nvcal/domain";
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
  disabled?: boolean;
}

function ColorSelector({ colors, selected, onSelect, disabled = false }: ColorSelectorProps) {
  const vimRef = useNavigable<HTMLDivElement>('create-calendar');

  const cycle = (dir: 1 | -1) => {
    if (disabled) return;
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
              disabled={disabled}
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
  selected: boolean;
  onSelect: () => void;
}

function ImportItem({ item, selected, onSelect }: ImportItemProps) {
  const vimRef = useNavigable<HTMLButtonElement>('create-calendar');

  return (
    <button
      type="button"
      ref={vimRef}
      class={`import-item ${selected ? 'checked' : ''}`}
      onClick={onSelect}
      style={{ '--calendar-color': item.color ?? '#6c7086' }}
    >
      <span class="import-check">{selected ? '✓' : ''}</span>
      <span class="calendar-color-indicator"></span>
      <span class="calendar-name">{item.name}</span>
    </button>
  );
}

function EmptyCalendarItem({
  onCreate,
  label = 'No calendars found',
}: {
  onCreate: () => void;
  label?: string;
}) {
  const vimRef = useNavigable<HTMLButtonElement>('sidebar-calendars');

  return (
    <button
      type="button"
      ref={vimRef}
      class="calendar-item empty-placeholder"
      onClick={onCreate}
      onKeyDown={(e) => {
        if (e.key === 'i') {
          e.preventDefault();
          e.stopPropagation();
          onCreate();
        }
      }}
      aria-label="Create calendar"
    >
      <span
        class="calendar-color-indicator"
        style={{ border: '1px dashed currentColor', background: 'transparent' }}
      >
      +
      </span>
      <span class="calendar-name" 
        style={{ fontStyle: 'italic', opacity: 0.7 }}
      >
        {label}
      </span>
    </button>
  );
}

interface SidebarCalendarsProps {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
  onCalendarsChanged: () => Promise<void>;
}

type CreateTab = 'create' | 'import';

export function SidebarCalendars({ calendars, loading, onCalendarsChanged }: SidebarCalendarsProps) {
  const vimContext = useContext(VimContext);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selectedColor, setSelectedColor] = useState(CALENDAR_PRESET_COLORS[0]);
  const [tab, setTab] = useState<CreateTab>('create');
  const [discoverable, setDiscoverable] = useState<GoogleCalendarItem[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importFetched, setImportFetched] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  const [importTimezone, setImportTimezone] = useState('');
  const [importColor, setImportColor] = useState(CALENDAR_PRESET_COLORS[0]);

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
    setSelectedImportId(null);
    setImportName('');
    setImportTimezone(detectedTimezone);
    setImportColor(CALENDAR_PRESET_COLORS[0]);
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
      const target = document.querySelector('.calendar-item') as HTMLElement | null;
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
      await onCalendarsChanged();
      closeCreate();
    } catch (err: any) {
      setCreateError(err.message ?? 'Failed to create calendar');
    }
  };

  const selectImport = (item: GoogleCalendarItem) => {
    if (selectedImportId === item.id) {
      setSelectedImportId(null);
      return;
    }

    setSelectedImportId(item.id);
    setImportName(item.name);
    setImportTimezone(item.timezone || detectedTimezone);
    setImportColor(item.color || CALENDAR_PRESET_COLORS[0]);
  };

  const handleImport = async (e?: SubmitEvent) => {
    e?.preventDefault();
    if (!selectedImportId || !importName.trim()) return;
    setCreateError('');
    const body: ImportGoogleCalendarInput = {
      googleCalendarId: selectedImportId,
      name: importName.trim(),
      timezone: importTimezone.trim() || 'UTC',
      color_hex: importColor,
    };
    try {
      await api<ApiResponse<'/api/sync/google/import POST'>>('/api/sync/google/import', 'POST', body);
      await onCalendarsChanged();
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
      </div>

      {loading ? (
        <div class="calendars-loading">Loading calendars...</div>
      ) : calendars.length === 0 ? (
        <div class="calendars-list">
          <EmptyCalendarItem onCreate={openCreate} />
        </div>
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
          <EmptyCalendarItem onCreate={openCreate} label="Create new Calendar" />
        </div>
      )}

      <VimDialog
        isOpen={showCreate}
        title={tab === 'create' ? 'New Calendar' : 'Import Calendar'}
        id="create-calendar-dialog"
        paneName="create-calendar"
        onClose={closeCreate}
        onSubmit={tab === 'create' ? handleCreate : handleImport}
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

            <VimFormRow
              paneName="create-calendar"
              onClickAction={() => (document.getElementById('create-calendar-dialog') as HTMLFormElement | null)?.requestSubmit()}
            >
              <button class="save-btn" type="submit">Create</button>
            </VimFormRow>
          </>
        ) : (
          <>
            {importLoading ? (
              <div class="calendars-loading">Loading...</div>
            ) : (
              <div class="import-list" aria-label="Google calendars">
                {discoverable.map((item) => (
                  <ImportItem
                    key={item.id}
                    item={item}
                    selected={selectedImportId === item.id}
                    onSelect={() => selectImport(item)}
                  />
                ))}
                {discoverable.length === 0 && (
                  <div class="calendars-empty">No calendars to import</div>
                )}
              </div>
            )}

            <VimFormRow paneName="create-calendar">
              <label>Name</label>
              <input
                name="import-name"
                type="text"
                value={importName}
                onInput={(e) => setImportName(e.currentTarget.value)}
                placeholder="Select a calendar"
                disabled={!selectedImportId}
                required
              />
            </VimFormRow>

            <VimFormRow paneName="create-calendar">
              <label>Timezone</label>
              <input
                name="import-timezone"
                type="text"
                value={importTimezone}
                onInput={(e) => setImportTimezone(e.currentTarget.value)}
                disabled={!selectedImportId}
              />
            </VimFormRow>

            <ColorSelector
              colors={importColor && !CALENDAR_PRESET_COLORS.includes(importColor)
                ? [...CALENDAR_PRESET_COLORS, importColor]
                : CALENDAR_PRESET_COLORS}
              selected={importColor}
              onSelect={setImportColor}
              disabled={!selectedImportId}
            />

            {createError && <div class="auth-error">{createError}</div>}

            <VimFormRow
              paneName="create-calendar"
              onClickAction={() => { void handleImport(); }}
            >
              <button
                class="save-btn"
                type="button"
                onClick={() => { void handleImport(); }}
                disabled={!selectedImportId || !importName.trim()}
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
