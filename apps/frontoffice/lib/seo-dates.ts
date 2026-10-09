export function warsawToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(today: string, days: number) {
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function offerDates(params: Record<string, string | string[] | undefined>, today: string) {
  const value = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const defaultStart = addDays(today, 14),
    defaultEnd = addDays(today, 21);
  const start = calendarDate(value('start')) ? value('start')! : defaultStart;
  const end = calendarDate(value('end')) ? value('end')! : defaultEnd;
  return end > start ? { start, end } : { start: defaultStart, end: defaultEnd };
}
