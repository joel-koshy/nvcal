export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getStartDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function generateMonthGrid(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const startDay = getStartDayOfMonth(year, month);
  const grid: (number | null)[] = [];
  
  for (let i = 0; i < startDay; i++) grid.push(null);
  for (let i = 1; i <= daysInMonth; i++) grid.push(i);
  
  return grid;
}

export function getWeekDays(date: Date): Date[] {
  const days = [];
  const start = new Date(date);
  
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}
