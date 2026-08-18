import { useState, useRef } from 'preact/hooks';
import { SidebarMonth } from '@/panes/SidebarMonth';
import { SidebarCalendars } from '@/panes/SidebarCalendars';
import { MainWeek } from '@/panes/MainWeek';
import { Topbar } from '@/panes/Topbar';
import { VimProvider } from './hooks/vim/VimProvider';
import { useEvents } from './hooks/useEvents';
import { useCalendars } from './hooks/useCalendars';

import type { NvCalState } from './types/ui';

interface AppProps {
  initialData: NvCalState;
}

export function App({ initialData }: AppProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const { events, loading, mutations } = useEvents(currentDate, initialData.events);
  const calendars = useCalendars();

  return (
    <VimProvider initialPane='sidebar'>
      <div ref={containerRef} class="app-layout">
        <aside class="sidebar">
          <div class="branding">NVCAL</div>
          <SidebarMonth date={currentDate} setDate={setCurrentDate} />
          <SidebarCalendars
            calendars={calendars.calendars}
            loading={calendars.loading}
            error={calendars.error}
          />
        </aside>

        <main class="main-content">
          <Topbar currentDate={currentDate} loggedIn={initialData.authenticated} />
          <MainWeek date={currentDate} setDate={setCurrentDate} events={events} loading={loading} mutations={mutations} />
        </main>
      </div>
    </VimProvider>
  );
}
