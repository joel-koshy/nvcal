import { useNavigable } from '@/hooks/vim/useNavigable';
import { usePane } from '@/hooks/vim/usePane';
import { generateMonthGrid } from '@/utils/date.ts';

interface SidebarDayProps{
  cellDate: number; 
  isActive: boolean; 
  onClick: () => void; 
}
function SidebarDay({cellDate, isActive, onClick}: SidebarDayProps){
  const vimRef = useNavigable<HTMLButtonElement>('sidebar')
  return (
    <button
      ref = {vimRef} 
      class = {`cell ${isActive? 'active' : ''}`}
      onClick={onClick}
    >
      {cellDate}
    </button>
  )
}

interface SidebarMonthProps {
  date: Date;
  setDate: (d: Date) => void;
}

export function SidebarMonth({ date, setDate }: SidebarMonthProps) {
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth();
  const grid = generateMonthGrid(currentYear, currentMonth);
  usePane('sidebar', {
    cols: 7, 
    flow: 'row', 
    neighbors: { right: 'main', down: 'sidebar-calendars' }
  });

  return (
    <div class="mini-month">
      <div class="header">
        {date.toLocaleString('default', { month: 'long', year: 'numeric' })}
      </div>
      <div class="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <div key={`header-${i}`} class="day-label">{day}</div>
        ))}
        
        {grid.map((cellDate, i) => {
          if (cellDate) {
            const isActive = cellDate === date.getDate();
            return (
              <SidebarDay 
                key={`day-${i}`}
                cellDate={cellDate}
                isActive={isActive}
                onClick={() => setDate(new Date(currentYear, currentMonth, cellDate))}
              />
            );
          }
          return <div key={`empty-${i}`} class="cell empty"></div>;
        })}
      </div>
    </div>
  );
}
