export function loadNotificationConfig(env = process.env) {
  const enabled = env.MAIL_REMINDERS_ENABLED === 'true';
  const newsletterEnabled = env.MAIL_NEWSLETTER_ENABLED === 'true';
  const mailProvider = env.MAIL_PROVIDER || 'local';
  if (!['local', 'ses'].includes(mailProvider)) throw new Error('INVALID_MAIL_PROVIDER');
  const cutoff = env.NOTIFICATION_START_AFTER || null;
  if ((enabled || newsletterEnabled) && (!cutoff ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff) ||
      !Number.isFinite(Date.parse(cutoff))))
    throw new Error('NOTIFICATION_START_AFTER_REQUIRED');
  const startAfter = cutoff && Number.isFinite(Date.parse(cutoff)) ? new Date(cutoff).toISOString() : null;
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error('INVALID_NOTIFICATION_CONFIG');
    return value;
  };
  return Object.freeze({
    enabled,
    newsletterEnabled,
    mailProvider,
    startAfter,
    sendHour: number('MAIL_REMINDERS_SEND_HOUR', 9, 0, 23),
    unreadDelayMinutes: number('MAIL_UNREAD_DELAY_MINUTES', 5, 1, 60),
    unreadCooldownHours: number('MAIL_UNREAD_COOLDOWN_HOURS', 12, 1, 168),
    batchSize: number('MAIL_REMINDERS_BATCH_SIZE', 100, 1, 500),
    appUrl: env.APP_URL || env.APP_ORIGIN || 'http://localhost:3100',
  });
}
export function localDay(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const localHour = (now) =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
export function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    ? value
    : null;
}
export const distanceDays = (from, to) =>
  Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400_000);
